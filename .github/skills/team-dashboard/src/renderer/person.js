// src/renderer/person.js — Person panel orchestrator.
// View renderers live in person-sprint.js, person-closure.js, person-period.js.
"use strict";

const { renderItemList } = require('./items.js');
const { renderPersonStalePrs } = require('./widgets.js');
const { detectBottlenecks } = require('../bottleneck-detector.js');
const { buildHierarchy } = require('../data-utils.js');
const { esc } = require('../suggestions-engine.js');
const { ADO_BASE, SPRINT_TYPES, DONE_STATES } = require('../constants.js');
const { renderSprintHygiene, renderTalkingPoints } = require('./person-sprint.js');
const { renderClosureView } = require('./person-closure.js');
const { renderPeriodView } = require('./person-period.js');

// ---------------------------------------------------------------------------
// renderPersonPanel(person, uiState, appData)
// ---------------------------------------------------------------------------
function renderPersonPanel(person, uiState, appData) {
  const roster = (appData.roster || {})[person.name] || {};
  const sprint = appData.sprint || {};
  const velocityPrev = appData.velocityPrev || {};
  const activePRs = appData.activePRs || [];
  const activeView = uiState.activeView || 'sprint';

  const bns = detectBottlenecks(person);
  const hierarchy = buildHierarchy(person.items);

  const sprintPts = person.items
    .reduce((s, i) => s + (i.storyPoints || 0), 0);
  const lastVel = velocityPrev[person.name];
  const lastPts = lastVel?.points ?? null;

  let velHtml = '';
  if (sprintPts > 0 || lastPts != null) {
    const delta = lastPts != null ? sprintPts - lastPts : null;
    const trend = delta != null ? (delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat') : null;
    const deltaHtml = delta != null
      ? ` <span class="velocity-badge ${trend}">${delta > 0 ? '+' : ''}${delta} vs prev</span>`
      : '';
    velHtml = `<span class="stat">Velocity: <b>${sprintPts} pts</b>${deltaHtml}</span>`;
  }

  const noteHtml = roster.note ? `<span class="stl-badge">${esc(roster.note)}</span>` : '';

  // Enhanced stats
  const currentItems = person.items.filter(i => i.sprintCategory === 'current');
  const storiesBugs = person.items.filter(i => i.type === 'User Story' || i.type === 'Bug');
  const activeStoriesBugs = storiesBugs.filter(i => i.state === 'Active');
  const blockedItems = person.items.filter(i => i.tags && i.tags.toUpperCase().includes('BLOCKED'));
  const silentItems = person.items.filter(i => i.state === 'Active' && i.commentCount === 0 && i.age?.sinceChanged > 3);
  const outOfSprintCount = person.items.filter(i => SPRINT_TYPES.has(i.type) && i.sprintCategory !== 'current' && !['Closed', 'Removed'].includes(i.state)).length;

  const statsHtml = `<div class="person-stats-enhanced">
    <div class="pse-row">
      <span class="stat" title="Stories and Bugs in Active state — these are the real work items (Tasks don't carry independent effort)">
        📋 <b>${activeStoriesBugs.length}</b> Active Stories/Bugs 
        <span class="stat-sub">(${activeStoriesBugs.reduce((s, i) => s + (i.storyPoints || 0), 0)} dev days)</span>
      </span>
      <span class="stat" title="Items assigned to current sprint (${esc(sprint.name || 'unknown')})">
        🎯 <b>${currentItems.length}</b> in current sprint
      </span>
      ${velHtml}
      ${noteHtml}
    </div>
    <div class="pse-signals">
      ${blockedItems.length ? `<span class="pse-signal pse-blocked" title="${esc(blockedItems.map(i => '#' + i.id + ' ' + i.title.substring(0, 40)).join('\n'))}">🚫 ${blockedItems.length} Blocked</span>` : ''}
      ${silentItems.length ? `<span class="pse-signal pse-silent" title="Active items with no comments and no field changes in 3+ days: ${esc(silentItems.map(i => '#' + i.id).join(', '))}">🔇 ${silentItems.length} Silent</span>` : ''}
      ${outOfSprintCount > 0 ? `<span class="pse-signal pse-offsprint" title="${outOfSprintCount} items assigned but not in current sprint — see Sprint Hygiene below">🧹 ${outOfSprintCount} off-sprint</span>` : ''}
      ${activeStoriesBugs.length > 3 ? `<span class="pse-signal pse-hoard" title="${activeStoriesBugs.length} stories/bugs Active simultaneously — possible context-switching pattern">🔄 High WIP</span>` : ''}
      ${!blockedItems.length && !silentItems.length && activeStoriesBugs.length <= 3 ? '<span class="pse-signal pse-clean">✓ No flags</span>' : ''}
    </div>
  </div>`;

  const talkingPointsHtml = renderTalkingPoints(person, appData);

  return `
    ${talkingPointsHtml}
    ${bns.length ? `<div class="bn-strip">${bns.map(b => {
      const icon = b.severity === 'high' ? '⚠' : '●';
      const link = b.itemId ? `<a href="${ADO_BASE}${b.itemId}" target="_blank" class="bn-link">#${b.itemId}</a> ` : '';
      return `<span class="bn-flag ${b.severity}">${icon} ${link}${esc(b.msg)}</span>`;
    }).join('')}</div>` : ''}
    ${statsHtml}
    ${renderPersonStalePrs(person.name, appData, uiState)}
    ${renderSprintHygiene(person, appData)}
    ${activeView === 'period' ? renderPeriodView(person, appData) : activeView === 'closure' ? renderClosureView(person, appData) : renderItemList(activeView === 'features' ? hierarchy.features : hierarchy.sprint)}
  `;
}

module.exports = { renderPersonPanel, renderSprintHygiene, renderTalkingPoints, renderClosureView, renderPeriodView };
