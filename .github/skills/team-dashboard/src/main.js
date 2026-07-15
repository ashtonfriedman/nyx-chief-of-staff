// src/main.js — Entry point. Initializes the dashboard after DOM ready,
// wires keyboard and delegated click/change handlers, runs clock and data-age intervals.
"use strict";

const { loadData }         = require('./data-loader.js');
const { appData, uiState } = require('./state.js');
const { extractSprints }   = require('./data-utils.js');
const { esc }              = require('./suggestions-engine.js');
const {
  render,
  renderPersonContentOnly,
  selectGroup,
  selectPerson,
  selectView,
  selectMode,
  navigateSprint,
  jumpToPerson,
  jumpToBottleneck,
  jumpToMostLoaded,
  jumpToMostActive,
} = require('./renderer/index.js');

// --- Clock & data-age helpers ---

function tickClock() {
  const el = document.getElementById('live-clock');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function updateDataAge() {
  const el = document.getElementById('data-age');
  if (el && uiState.currentData && uiState.currentData.generatedAt) {
    const mins = Math.round((Date.now() - new Date(uiState.currentData.generatedAt).getTime()) / 60000);
    const label = mins < 60 ? mins + 'm ago' : Math.floor(mins / 60) + 'h ago';
    el.textContent = '\u00B7 Data: ' + label;
    el.className = mins >= 240 ? 'data-stale' : mins >= 60 ? 'data-warn' : 'data-fresh';
  }
  const tsEl = document.getElementById('refresh-timestamp');
  if (tsEl && appData.generatedAt) {
    tsEl.textContent = 'Last refresh: ' + new Date(appData.generatedAt).toLocaleString('en-US', {
      month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }
}

// --- Shortcuts overlay ---

(function() {
  var ov = document.createElement('div');
  ov.className = 'shortcuts-overlay';
  ov.id = 'shortcuts-overlay';
  ov.innerHTML = '<div class="so-box">' +
    '<h3>\u2328 Keyboard Shortcuts</h3>' +
    '<dl>' +
    '<dt>1-9</dt><dd>Jump to person by index</dd>' +
    '<dt>Esc</dt><dd>Back to team overview</dd>' +
    '<dt>s</dt><dd>Sprint Work view</dd>' +
    '<dt>f</dt><dd>Features view</dd>' +
    '<dt>c</dt><dd>Sprint Closure view</dd>' +
    '<dt>r</dt><dd>Period Risk view</dd>' +
    '<dt>[ / ]</dt><dd>Previous / Next sprint</dd>' +
    '<dt>a</dt><dd>Switch to All (show everyone)</dd>' +
    '<dt>t</dt><dd>Switch to My Team</dd>' +
    '<dt>m</dt><dd>Switch to Peer Group</dd>' +
    '<dt>h</dt><dd>Hygiene workbench</dd>' +
    '<dt>?</dt><dd>Toggle this help</dd>' +
    '</dl></div>';
  ov.addEventListener('click', function(e) { if (e.target === ov) ov.classList.remove('visible'); });
  document.body.appendChild(ov);
})();

function toggleShortcuts() {
  document.getElementById('shortcuts-overlay').classList.toggle('visible');
}

// --- Keyboard navigation ---

document.addEventListener('keydown', function(e) {
  var tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  var key = e.key;

  if (key === '?') { e.preventDefault(); toggleShortcuts(); return; }

  if (key === '[') { navigateSprint(-1); return; }
  if (key === ']') { navigateSprint(1); return; }

  var ov = document.getElementById('shortcuts-overlay');
  if (key === 'Escape' && ov && ov.classList.contains('visible')) {
    ov.classList.remove('visible'); return;
  }

  if (key === 'Escape' && uiState.activeMode === 'hygiene') { selectMode('team'); return; }

  if (key === 'Escape') { selectPerson(null); return; }

  // View switches
  if (key === 's') { selectView('sprint'); return; }
  if (key === 'f') { selectView('features'); return; }
  if (key === 'c') { selectView('closure'); return; }
  if (key === 'r') { selectView('period'); return; }
  if (key === 'h') { uiState.activeMode === 'hygiene' ? selectMode('team') : selectMode('hygiene'); return; }

  // Group switches
  if (key === 'a') { selectGroup('all'); return; }
  if (key === 't') { selectGroup('my-team'); return; }
  if (key === 'm') { selectGroup('peer-group'); return; }

  // 1-9 — jump to person by index in current group
  if (key >= '1' && key <= '9') {
    var idx = parseInt(key, 10) - 1;
    var sel = document.querySelector('.selector-bar select:nth-of-type(2)');
    if (!sel) return;
    var opt = sel.options[idx + 1];
    if (opt) selectPerson(opt.value);
  }
});

// --- Delegated click handler ---

document.addEventListener('click', function(e) {
  var el = e.target.closest('[data-action]');
  if (!el) return;
  var action = el.dataset.action;

  switch (action) {
    case 'jump-to-person':
      jumpToPerson(el.dataset.name);
      break;
    case 'select-person':
      jumpToPerson(el.dataset.person || el.dataset.name);
      break;
    case 'toggle-group':
      if (e.target.closest('a') || e.target.closest('.detail-toggle')) return;
      el.classList.toggle('collapsed');
      break;
    case 'toggle-detail':
      e.stopPropagation();
      el.closest('.wi-group').classList.toggle('detail-open');
      break;
    case 'navigate-sprint':
      e.stopPropagation();
      navigateSprint(parseInt(el.dataset.dir));
      break;
    case 'filter-wp': {
      var bar = el.closest('.wp-filter-bar');
      bar.querySelectorAll('.wp-filter-btn').forEach(function(b) { b.classList.remove('active'); });
      el.classList.add('active');
      var container = el.closest('.work-patterns').querySelector('.wp-rows-container');
      var allowed = el.dataset.group ? el.dataset.group.split(',') : null;
      container.querySelectorAll('.wp-row, .wp-group-label').forEach(function(row) {
        if (!allowed) { row.style.display = ''; return; }
        var group = row.dataset.group;
        row.style.display = (group && allowed.includes(group)) ? '' : 'none';
      });
      break;
    }
    case 'toggle-collapse': {
      var target = el.dataset.target ? el.closest(el.dataset.target) : el;
      if (target) target.classList.toggle('collapsed');
      break;
    }
    case 'toggle-collapse-wp':
      if (e.target.closest('.wp-row') || e.target.closest('.wp-filter-bar')) return;
      el.classList.toggle('collapsed');
      break;
    case 'toggle-collapse-ho':
      if (e.target.closest('.ho-row')) return;
      el.classList.toggle('collapsed');
      break;
    case 'toggle-open': {
      var openTarget = el.closest(el.dataset.target || '.change-feed');
      if (openTarget) openTarget.classList.toggle('open');
      break;
    }
    case 'jump-to-most-loaded':
      jumpToMostLoaded();
      break;
    case 'jump-to-most-active':
      jumpToMostActive();
      break;
    case 'jump-to-bottleneck':
      jumpToBottleneck();
      break;
    case 'toggle-shortcuts':
      toggleShortcuts();
      break;
    case 'return-to-current':
      e.preventDefault();
      uiState.selectedSprintIdx = uiState.availableSprints.findIndex(function(s) {
        return s.name === appData.sprintData?.name;
      });
      render();
      break;
    case 'toggle-unest-details': {
      var details = document.getElementById('unest-details');
      if (details) details.classList.toggle('open');
      el.textContent = el.textContent === 'Show Details' ? 'Hide Details' : 'Show Details';
      break;
    }
    case 'dismiss-banner':
      var banner = el.closest('.unestimated-banner');
      if (banner) banner.remove();
      break;
    case 'toggle-stale-prs': {
      var stalePrList = document.querySelector('.stale-pr-list');
      if (stalePrList) stalePrList.classList.toggle('hidden');
      break;
    }
    case 'open-hygiene':
      selectMode('hygiene');
      break;
    case 'close-hygiene':
      selectMode('team');
      break;
    case 'hygiene-category':
      uiState.hygieneFilter.category = el.dataset.value;
      renderPersonContentOnly();
      break;
    case 'hygiene-user':
      uiState.hygieneFilter.user = el.dataset.value || null;
      renderPersonContentOnly();
      break;
    case 'hygiene-type':
      uiState.hygieneFilter.type = el.dataset.value || null;
      renderPersonContentOnly();
      break;
  }
});

// --- Delegated change handler for selects ---

document.addEventListener('change', function(e) {
  var el = e.target;
  var action = el.dataset && el.dataset.action;
  if (!action) return;

  switch (action) {
    case 'group-select':
      selectGroup(el.value);
      break;
    case 'person-select':
      selectPerson(el.value);
      break;
    case 'view-select':
      selectView(el.value);
      break;
  }
});

// --- Refresh UI ---

function initRefresh() {
  var progressBar = document.createElement('div');
  progressBar.id = 'refresh-progress-bar';
  progressBar.className = 'refresh-progress hidden';
  progressBar.innerHTML = '<div class="refresh-progress-fill"></div>';
  document.body.insertBefore(progressBar, document.getElementById('app'));

  var eventSource = null;

  function startRefresh() {
    if (eventSource) eventSource.close();
    progressBar.classList.remove('hidden');
    progressBar.classList.add('running');
    setProgressFill(0);

    var csrfMeta = document.querySelector('meta[name="csrf-token"]');
    var csrfToken = csrfMeta ? csrfMeta.getAttribute('content') : '';
    eventSource = new EventSource('/api/refresh?token=' + encodeURIComponent(csrfToken));

    eventSource.addEventListener('progress', function(e) {
      var d = JSON.parse(e.data);
      if (d.total > 0) setProgressFill(Math.round(d.n / d.total * 80));
      setRefreshStatus(d.msg);
    });

    eventSource.addEventListener('complete', function() {
      setProgressFill(100);
      setRefreshStatus('Done \u2014 reloading\u2026');
      setTimeout(function() {
        loadData().then(function(ok) {
          if (ok) {
            render();
            updateDataAge();
          }
          progressBar.classList.remove('running');
          progressBar.classList.add('hidden');
          setProgressFill(0);
          setRefreshStatus('');
        });
      }, 400);
      eventSource.close(); eventSource = null;
    });

    eventSource.addEventListener('error', function(e) {
      var msg = e.data ? JSON.parse(e.data).msg : 'Refresh failed';
      setRefreshStatus('\u26A0 ' + msg);
      progressBar.classList.remove('running');
      setTimeout(function() { progressBar.classList.add('hidden'); }, 3000);
      eventSource.close(); eventSource = null;
    });
  }

  function setProgressFill(pct) {
    var fill = progressBar.querySelector('.refresh-progress-fill');
    if (fill) fill.style.width = pct + '%';
  }

  function setRefreshStatus(msg) {
    var el = document.getElementById('refresh-status');
    if (el) el.textContent = msg;
  }

  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action="refresh"]');
    if (el) startRefresh();
  });
}

// --- Init ---

loadData().then(function(ok) {
  if (!ok) return;
  uiState.availableSprints = extractSprints(appData.embedItems);
  uiState.selectedSprintIdx = uiState.availableSprints.findIndex(
    function(s) { return s.name === appData.sprint.name; }
  );
  if (uiState.selectedSprintIdx === -1) {
    uiState.selectedSprintIdx = uiState.availableSprints.length - 1;
  }
  render();
  initRefresh();
  tickClock(); updateDataAge();
  setInterval(tickClock, 1000);
  setInterval(updateDataAge, 60000);
}).catch(function(err) {
  console.error('[dash] Init failed:', err);
  document.getElementById('app').innerHTML =
    '<div style="padding:40px;color:#f85149">\u26A0 Dashboard init failed<br>' +
    '<pre style="color:#8b949e;white-space:pre-wrap;">' + esc(err.stack || String(err)) + '</pre></div>';
});

module.exports = { selectGroup, selectPerson, selectView, selectMode, jumpToPerson };
