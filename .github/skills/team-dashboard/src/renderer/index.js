// src/renderer/index.js — Render orchestrator.
// Reads state, computes derived values, calls sub-renderers, writes one innerHTML to #app.
"use strict";

const { appData, uiState } = require('../state.js');
const { normalizeData, buildHierarchy } = require('../data-utils.js');
const { detectBottlenecks } = require('../bottleneck-detector.js');
const { esc } = require('../suggestions-engine.js');
const { SPRINT_TYPES } = require('../constants.js');
const { buildHeader, buildSummaryBar, buildSprintBar, buildFooter } = require('./chrome.js');
const { renderPersonPanel } = require('./person.js');
const { renderTeamOverview, renderHygieneOverview } = require('./team.js');
const { renderActivityStrip, renderChangeFeed, renderWorkPatterns } = require('./activity.js');
const { renderStalePrBanner, renderSuggestionsPanel } = require('./widgets.js');
const { renderHygieneTab } = require('./hygiene.js');

// --- Helpers (mirror chrome.js local helpers for render-time checks) ---

function isViewingCurrentSprint() {
  if (uiState.selectedSprintIdx < 0 || !uiState.availableSprints.length) return true;
  return uiState.availableSprints[uiState.selectedSprintIdx]?.name === appData.sprintData?.name;
}

function getSelectedSprintName() {
  if (uiState.selectedSprintIdx < 0 || !uiState.availableSprints[uiState.selectedSprintIdx]) {
    return appData.sprint?.name || '';
  }
  return uiState.availableSprints[uiState.selectedSprintIdx].name;
}

// --- Render context computation (data pipeline, no DOM) ---

function computeRenderContext() {
  const sprintFilter = isViewingCurrentSprint()
    ? null
    : uiState.availableSprints[uiState.selectedSprintIdx]?.name;
  uiState.sprintFilter = sprintFilter;
  const data = normalizeData(appData.embedItems, sprintFilter, appData.generatedAt, appData.sprint?.name);
  if (!data) return null;

  uiState.currentData = data;

  // Compute bottlenecks once per person, reuse everywhere
  const bottleneckCache = new Map();
  for (const p of data.people) bottleneckCache.set(p.name, detectBottlenecks(p));

  const people = data.people.sort((a, b) => {
    const relOrder = r => ({ direct: 0, peer: 1, manager: 2 }[r] ?? 3);
    const rA = (appData.roster[a.name] || {}).rel;
    const rB = (appData.roster[b.name] || {}).rel;
    const ro = relOrder(rA) - relOrder(rB);
    if (ro !== 0) return ro;
    return (bottleneckCache.get(b.name) || []).length - (bottleneckCache.get(a.name) || []).length;
  });

  if (uiState.activePerson && !people.find(p => p.name === uiState.activePerson)
      && !(appData.roster || {})[uiState.activePerson]) {
    uiState.activePerson = null;
  }

  // Ensure all roster members appear even if they have no items this sprint
  const peopleNames = new Set(people.map(p => p.name));
  for (const [name, info] of Object.entries(appData.roster || {})) {
    if (!peopleNames.has(name)) {
      people.push({ name, items: [], group: info.group, _rosterOnly: true });
    }
  }

  // Group people
  const myTeam = people.filter(p => ((appData.roster[p.name] || {}).group || 'other') === 'my-team');
  const missionApps = people.filter(p => ((appData.roster[p.name] || {}).group || 'other') === 'peer-group');
  const others = people.filter(p => {
    const g = (appData.roster[p.name] || {}).group;
    return g !== 'my-team' && g !== 'peer-group';
  });

  const GROUPS = new Map();
  GROUPS.set('all', { label: 'All', people: people.filter(p => p.name !== 'Unassigned') });
  GROUPS.set('my-team', { label: 'My Team', people: myTeam });
  GROUPS.set('peer-group', { label: 'Peer Group', people: missionApps });
  if (others.length) GROUPS.set('other', { label: 'Other', people: others });

  if (!GROUPS.has(uiState.activeGroup)) uiState.activeGroup = 'my-team';

  // Auto-switch to active person's group (unless viewing 'all')
  if (uiState.activePerson && uiState.activeGroup !== 'all') {
    const apGroup = (appData.roster[uiState.activePerson] || {}).group || 'other';
    if (GROUPS.has(apGroup)) uiState.activeGroup = apGroup;
  }

  const groupPeople = GROUPS.get(uiState.activeGroup)?.people || [];

  // Sprint view: only show people with qualifying execution work (not just Epics/Features)
  let visiblePeople = groupPeople;
  if (uiState.activeView === 'sprint') {
    visiblePeople = groupPeople.filter(p =>
      p.items.some(i => SPRINT_TYPES.has(i.type) && (sprintFilter ? true : i.sprintCategory === 'current'))
    );
  }

  if (uiState.activePerson && !groupPeople.find(p => p.name === uiState.activePerson)) {
    uiState.activePerson = null;
  }

  const isHygiene = uiState.activeMode === 'hygiene';

  return { data, bottleneckCache, people, GROUPS, groupPeople, visiblePeople, sprintFilter, isHygiene };
}

// --- Build person-content HTML (used by both full and partial render) ---

function buildPersonContent(people, ctx) {
  const { visiblePeople, isHygiene } = ctx;
  if (isHygiene) {
    return renderHygieneTab(appData, uiState);
  }
  if (!uiState.activePerson) {
    return renderTeamOverview(visiblePeople, uiState, appData);
  }
  const ap = people.find(p => p.name === uiState.activePerson);
  return ap
    ? renderPersonPanel(ap, uiState, appData)
    : '<div class="empty-state">No person selected</div>';
}

// --- Partial re-render (person-content div only) ---

function renderPersonContentOnly() {
  const ctx = computeRenderContext();
  if (!ctx) return;
  const el = document.querySelector('.person-content');
  if (!el) { render(); return; }
  el.innerHTML = buildPersonContent(ctx.people, ctx);
}

// --- render() ---

function render() {
  const ctx = computeRenderContext();
  if (!ctx) return;
  const { bottleneckCache, people, GROUPS, groupPeople, visiblePeople, isHygiene } = ctx;

  // Person selector option builder
  function personOption(p) {
    const bn = bottleneckCache.get(p.name) || [];
    const high = bn.filter(b => b.severity === 'high').length;
    const dot = high > 0 ? '🔴' : bn.length > 0 ? '🟡' : '🟢';
    const sel = p.name === uiState.activePerson ? ' selected' : '';
    return `<option value="${esc(p.name).replace(/"/g, '&quot;')}"${sel}>${dot} ${esc(p.name)} (${p.items.length})</option>`;
  }

  // --- Top-level mode tabs (always visible) ---
  const modeTabsHtml = `
    <div class="mode-tabs">
      <button class="mode-tab${!isHygiene ? ' active' : ''}" data-action="close-hygiene">👥 Team</button>
      <button class="mode-tab${isHygiene ? ' active' : ''}" data-action="open-hygiene">🧹 Hygiene</button>
    </div>`;

  // --- Hygiene: standalone display ---
  if (isHygiene) {
    document.getElementById('app').innerHTML =
      buildHeader(people, groupPeople) +
      modeTabsHtml +
      '<div class="person-content">' + renderHygieneTab(appData, uiState) + '</div>' +
      buildFooter();
    return;
  }

  // --- Team: group/person/view selectors ---
  const teamControlsHtml = `
    <div class="selector-bar">
      <label>Team</label>
      <select class="sel" data-action="group-select">
        ${Array.from(GROUPS.entries()).map(([k, v]) =>
          `<option value="${k}"${k === uiState.activeGroup ? ' selected' : ''}>${v.label} (${v.people.length})</option>`
        ).join('')}
      </select>
      <span class="sel-divider"></span>
      <label>Person</label>
      <select class="sel" data-action="person-select">
        <option value=""${!uiState.activePerson ? ' selected' : ''}>📊 All (Overview)</option>
        ${groupPeople.map(personOption).join('')}
      </select>
      ${uiState.activePerson ? `<span class="sel-divider"></span>
      <label>View</label>
      <select class="sel" data-action="view-select">
        <option value="sprint"${uiState.activeView === 'sprint' ? ' selected' : ''} title="All stories, bugs, and tasks assigned to this person in the current sprint. Grouped by parent item with tasks nested underneath.">Sprint Work</option>
        <option value="features"${uiState.activeView === 'features' ? ' selected' : ''} title="Feature-level view showing epics and features with their child stories. Use this to see progress on larger initiatives.">Features</option>
        <option value="closure"${uiState.activeView === 'closure' ? ' selected' : ''} ${!isViewingCurrentSprint() ? 'disabled title="Not available for historical sprints"' : 'title="Sprint closure readiness: what\'s done, what\'s at risk, and whether this person will finish their sprint commitment."'}>Sprint Closure${!isViewingCurrentSprint() ? ' (N/A)' : ''}</option>
        <option value="period"${uiState.activeView === 'period' ? ' selected' : ''} title="Items planned across the period (epics, features) and their health. Items here span multiple sprints.">Period Risk</option>
      </select>` : ''}
    </div>
  `;

  // Panel content
  const panelHtml = buildPersonContent(people, ctx);

  const historicalBanner = !isViewingCurrentSprint()
    ? '<div class="historical-banner"><span>\uD83D\uDCDC Viewing <b>' + esc(getSelectedSprintName()) + '</b> \u2014 historical data. <a href="#" data-action="return-to-current">Return to current sprint</a></span></div>'
    : '';

  document.getElementById('app').innerHTML =
    buildHeader(people, groupPeople) +
    buildSummaryBar(people, groupPeople) +
    buildSprintBar() +
    historicalBanner +
    renderSuggestionsPanel(people, appData, uiState) +
    modeTabsHtml +
    teamControlsHtml +
    renderActivityStrip(people, appData) +
    renderStalePrBanner(appData, uiState) +
    '<div class="person-content">' + panelHtml + '</div>' +
    buildFooter();
}

// --- Action handlers ---

function selectGroup(g) {
  uiState.activeGroup = g;
  uiState.activePerson = null;
  render();
}

function selectPerson(n) {
  uiState.activePerson = n || null;
  render();
}

function selectView(v) {
  if (v === 'hygiene') {
    uiState.activeMode = 'hygiene';
    render();
    return;
  }
  const wasTeamWithPerson = uiState.activeMode === 'team' && uiState.activePerson;
  uiState.activeMode = 'team';
  uiState.activeView = v;
  if (wasTeamWithPerson) {
    // Partial: update view select + person content only
    const viewSel = document.querySelector('select[data-action="view-select"]');
    if (viewSel) viewSel.value = v;
    renderPersonContentOnly();
  } else {
    render();
  }
}

function selectMode(m) {
  uiState.activeMode = m;
  render();
}

function navigateSprint(delta) {
  const newIdx = uiState.selectedSprintIdx + delta;
  if (newIdx < 0 || newIdx >= uiState.availableSprints.length) return;
  uiState.selectedSprintIdx = newIdx;
  if (!isViewingCurrentSprint() && uiState.activeView === 'closure') uiState.activeView = 'sprint';
  render();
}

function jumpToPerson(name) {
  const group = (appData.roster[name] || {}).group || 'other';
  if (uiState.activeGroup !== 'all') uiState.activeGroup = group;
  uiState.activePerson = name;
  render();
}

function jumpToBottleneck() {
  if (!uiState.currentData) return;
  for (const p of uiState.currentData.people) {
    const bn = detectBottlenecks(p);
    if (bn.some(b => b.severity === 'high')) {
      jumpToPerson(p.name); return;
    }
  }
  for (const p of uiState.currentData.people) {
    if (detectBottlenecks(p).length > 0) {
      jumpToPerson(p.name); return;
    }
  }
}

function jumpToMostLoaded() {
  if (!uiState.currentData) return;
  const sorted = [...uiState.currentData.people]
    .filter(p => p.name !== 'Unassigned')
    .sort((a, b) => b.items.length - a.items.length);
  if (sorted[0]) jumpToPerson(sorted[0].name);
}

function jumpToMostActive() {
  if (!uiState.currentData) return;
  const sorted = [...uiState.currentData.people].sort((a, b) =>
    b.items.filter(i => i.state === 'Active').length - a.items.filter(i => i.state === 'Active').length
  );
  if (sorted[0]) jumpToPerson(sorted[0].name);
}

// --- Sprint-view people filter (exported for testing) ---

function filterSprintPeople(people, sprintFilter) {
  return people.filter(p =>
    p.items.some(i => SPRINT_TYPES.has(i.type) && (sprintFilter ? true : i.sprintCategory === 'current'))
  );
}

module.exports = {
  render,
  renderPersonContentOnly,
  computeRenderContext,
  filterSprintPeople,
  selectGroup,
  selectPerson,
  selectView,
  selectMode,
  navigateSprint,
  jumpToPerson,
  jumpToBottleneck,
  jumpToMostLoaded,
  jumpToMostActive,
};
