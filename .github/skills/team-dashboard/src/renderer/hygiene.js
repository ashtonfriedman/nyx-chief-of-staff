// src/renderer/hygiene.js — Full hygiene-tab renderer.
// Pure query functions live in hygiene-queries.js; this file only renders.
"use strict";

const {
  getOrphanedItems,
  getStuckItems,
  getWrongIterationItems,
  getUnestimatedItems,
  getEmptyShells,
  applyHygieneFilters,
} = require('../hygiene-queries.js');
const { getStalePrs, stalePrAgeClass } = require('./widgets.js');
const { typeClass } = require('./items.js');
const { esc } = require('../suggestions-engine.js');
const { ADO_BASE, ADO_PR_BASE } = require('../constants.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate to maxLen with ellipsis. */
function trunc(s, maxLen) {
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '…' : s;
}

/** Last segment of an iteration path like "Project\\Sprint 5". */
function lastIterationSegment(iterPath) {
  if (!iterPath) return '—';
  const parts = iterPath.split('\\');
  return parts[parts.length - 1] || '—';
}

/** Collect unique assignees from an array of items. */
function collectAssignees(items) {
  const set = new Set();
  for (const i of items) { if (i.assigned) set.add(i.assigned); }
  return Array.from(set).sort();
}

/** Collect unique work-item types from an array of items. */
function collectTypes(items) {
  const set = new Set();
  for (const i of items) { if (i.type) set.add(i.type); }
  return Array.from(set).sort();
}

/** Standard item row HTML. extraCols is injected between state and assignee. */
function itemRow(item, extraCols) {
  const title = trunc(item.title, 60);
  return `<div class="hyg-item-row">
  <a href="${ADO_BASE}${item.id}" target="_blank" class="hyg-id">#${item.id}</a>
  <span class="wi-type ${typeClass(item.type)}">${esc(item.type)}</span>
  <span class="hyg-title" title="${esc(item.title)}">${esc(title)}</span>
  <span class="hyg-state">${esc(item.state)}</span>
  ${extraCols}
  <span class="hyg-assignee">${esc(item.assigned || '—')}</span>
</div>`;
}

/** Wrap a section with collapsible header. */
function section(cssExtra, icon, label, count, actionHint, bodyHtml) {
  if (!bodyHtml) return '';
  return `<div class="hyg-section ${cssExtra}">
  <div class="hyg-section-header" data-action="toggle-collapse-hyg">
    <span>${icon} ${esc(label)} <span class="hyg-count">(${count})</span></span>
    <span>
      <span class="hyg-action-hint">${esc(actionHint)}</span>
      <span class="section-toggle">▶</span>
    </span>
  </div>
  <div class="hyg-section-body">${bodyHtml}</div>
</div>`;
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

function renderHygieneFilterBar(items, activePRs, roster, uiState, queryResults) {
  const filter = uiState.hygieneFilter;
  const cat = filter.category;

  // Use precomputed query results instead of re-running queries
  const orphanedCount = queryResults.orphaned.length;
  const stalePrCount = queryResults.stalePrs.length;
  const stuckCount = queryResults.stuck.length;
  const wrongIterCount = queryResults.wrongIter.length;
  const unestCount = queryResults.unest.length;
  const emptyCount = queryResults.empty.length;
  const totalCount = orphanedCount + stalePrCount + stuckCount + wrongIterCount + unestCount + emptyCount;

  const pills = [
    ['all',              '📋', 'All',             totalCount],
    ['orphaned',         '🚫', 'Orphaned',        orphanedCount],
    ['stale-prs',        '🔴', 'Stale PRs',       stalePrCount],
    ['stuck',            '🧊', 'Stuck',           stuckCount],
    ['wrong-iteration',  '🔄', 'Wrong Iteration', wrongIterCount],
    ['unestimated',      '❓', 'Unestimated',     unestCount],
    ['empty-shells',     '📦', 'Empty Shells',    emptyCount],
  ];

  const pillsHtml = pills.map(([value, icon, label, count]) => {
    const active = cat === value ? ' active' : '';
    return `<button class="hyg-filter-btn${active}" data-action="hygiene-category" data-value="${value}">${icon} ${label} <span class="hyg-count">(${count})</span></button>`;
  }).join('\n    ');

  // Collect assignees and types across all categories for dropdowns (use precomputed results)
  const allItems = [].concat(
    queryResults.orphaned, queryResults.stuck, queryResults.wrongIter,
    queryResults.unest, queryResults.empty
  );

  // Add stale PR authors to assignee set
  const assignees = collectAssignees(allItems);
  for (const pr of queryResults.stalePrs) {
    if (pr.createdBy && !assignees.includes(pr.createdBy)) assignees.push(pr.createdBy);
  }
  assignees.sort();

  const types = collectTypes(allItems);

  const userOpts = assignees.map(a => {
    const sel = filter.user === a ? ' selected' : '';
    return `<option value="${esc(a)}"${sel}>${esc(a)}</option>`;
  }).join('');

  const typeOpts = types.map(t => {
    const sel = filter.type === t ? ' selected' : '';
    return `<option value="${esc(t)}"${sel}>${esc(t)}</option>`;
  }).join('');

  return `<div class="hygiene-filter-bar">
  <div class="hyg-category-pills">
    ${pillsHtml}
  </div>
  <div class="hyg-filter-dropdowns">
    <label>Person:</label>
    <select data-action="hygiene-user">
      <option value="">All</option>
      ${userOpts}
    </select>
    <label>Type:</label>
    <select data-action="hygiene-type">
      <option value="">All</option>
      ${typeOpts}
    </select>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderOrphanedSection(items, roster, filter) {
  const raw = getOrphanedItems(items, roster);
  const filtered = applyHygieneFilters(raw, filter);
  if (!filtered.length) return '';
  const rows = filtered.map(i =>
    itemRow(i, '<span class="hyg-orphan-badge">not in roster</span>')
  ).join('');
  return section('orphaned', '🚫', 'Orphaned Items', filtered.length,
    'Reassign or add to roster', rows);
}

function renderStalePrsSection(activePRs, uiState, filter) {
  if (filter.type) return ''; // PRs don't have work-item types
  const stale = getStalePrs(activePRs, uiState.stalePrThresholdDays);
  const filtered = filter.user
    ? stale.filter(pr => pr.createdBy === filter.user)
    : stale;
  if (!filtered.length) return '';
  const rows = filtered.map(pr => {
    const title = trunc(pr.title, 60);
    const prUrl = `${ADO_PR_BASE}${pr.prId}`;
    return `<div class="hyg-item-row stale-pr">
  <a href="${prUrl}" target="_blank" class="hyg-id">PR&nbsp;${pr.prId}</a>
  <span class="spr-repo">${esc(pr.repo || '')}</span>
  <span class="hyg-title" title="${esc(pr.title)}">${esc(title)}</span>
  <span class="hyg-age ${stalePrAgeClass(pr.ageDays)}">${pr.ageDays}d</span>
  <span class="hyg-state">${esc(pr.status || 'active')}</span>
  <span class="hyg-assignee">${esc(pr.createdBy || '—')}</span>
</div>`;
  }).join('');
  return section('stale-prs', '🔴', 'Stale Pull Requests', filtered.length,
    'Complete, close or reassign', rows);
}

function renderStuckSection(items, stuckDaysThreshold, filter) {
  const raw = getStuckItems(items, stuckDaysThreshold);
  const filtered = applyHygieneFilters(raw, filter);
  if (!filtered.length) return '';
  const rows = filtered.map(i => {
    const days = (i.age && i.age.sinceStateChange) || 0;
    const sev = days >= 30 ? 'red' : days >= 21 ? 'orange' : 'yellow';
    return itemRow(i, `<span class="hyg-age ${sev}">${days}d in ${esc(i.state)}</span>`);
  }).join('');
  return section('stuck', '🧊', 'Stuck Items', filtered.length,
    'Unblock or update state', rows);
}

function renderWrongIterationSection(items, filter) {
  const raw = getWrongIterationItems(items);
  const filtered = applyHygieneFilters(raw, filter);
  if (!filtered.length) return '';
  const rows = filtered.map(i => {
    const iter = lastIterationSegment(i.iteration);
    return itemRow(i, `<span class="hyg-iteration" title="${esc(i.iteration)}">${esc(iter)}</span>`);
  }).join('');
  return section('wrong-iteration', '🔄', 'Wrong Iteration', filtered.length,
    'Move to current sprint or close', rows);
}

function renderUnestimatedSection(items, filter) {
  const raw = getUnestimatedItems(items);
  const filtered = applyHygieneFilters(raw, filter);
  if (!filtered.length) return '';
  const rows = filtered.map(i =>
    itemRow(i, '<span class="hyg-action-hint">Add story points</span>')
  ).join('');
  return section('unestimated', '❓', 'Unestimated Items', filtered.length,
    'Add story points', rows);
}

function renderEmptyShellsSection(items, filter) {
  const raw = getEmptyShells(items);
  const filtered = applyHygieneFilters(raw, filter);
  if (!filtered.length) return '';
  const rows = filtered.map(i => {
    const iter = lastIterationSegment(i.iteration);
    return itemRow(i, `<span class="hyg-iteration" title="${esc(i.iteration)}">${esc(iter)}</span>`);
  }).join('');
  return section('empty-shells', '📦', 'Empty Shells', filtered.length,
    'Add children or close', rows);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

function renderHygieneTab(appData, uiState) {
  const { embedItems, activePRs, roster } = appData;
  const filter = uiState.hygieneFilter;
  const cat = filter.category;

  // Run each query ONCE, reuse results for header, filter bar, and sections
  const queryResults = {
    orphaned: getOrphanedItems(embedItems, roster),
    stuck: getStuckItems(embedItems, uiState.stuckDaysThreshold),
    wrongIter: getWrongIterationItems(embedItems),
    unest: getUnestimatedItems(embedItems),
    empty: getEmptyShells(embedItems),
    stalePrs: getStalePrs(activePRs, uiState.stalePrThresholdDays),
  };
  const totalIssues = queryResults.orphaned.length + queryResults.stuck.length +
    queryResults.wrongIter.length + queryResults.unest.length + queryResults.empty.length;

  return `<div class="hygiene-tab">
  <div class="hygiene-tab-header">
    <h2>🧹 ADO Hygiene Workbench <span class="hyg-total">${totalIssues} issues</span></h2>
    <p class="hygiene-tab-desc">Backlog grooming dashboard. Items here need attention — orphaned work, stale PRs, stuck items, wrong iterations.</p>
  </div>
  ${renderHygieneFilterBar(embedItems, activePRs, roster, uiState, queryResults)}
  <div class="hygiene-tab-sections">
    ${cat === 'all' || cat === 'orphaned' ? renderOrphanedSection(embedItems, roster, filter) : ''}
    ${cat === 'all' || cat === 'stale-prs' ? renderStalePrsSection(activePRs, uiState, filter) : ''}
    ${cat === 'all' || cat === 'stuck' ? renderStuckSection(embedItems, uiState.stuckDaysThreshold, filter) : ''}
    ${cat === 'all' || cat === 'wrong-iteration' ? renderWrongIterationSection(embedItems, filter) : ''}
    ${cat === 'all' || cat === 'unestimated' ? renderUnestimatedSection(embedItems, filter) : ''}
    ${cat === 'all' || cat === 'empty-shells' ? renderEmptyShellsSection(embedItems, filter) : ''}
  </div>
</div>`;
}

module.exports = { renderHygieneTab };
