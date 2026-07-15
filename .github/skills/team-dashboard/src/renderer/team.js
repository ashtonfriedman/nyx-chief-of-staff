// src/renderer/team.js — Team overview cards and sprint hygiene.
// Extracted from team-dashboard.js (Phase 1E).
"use strict";

const { SPRINT_TYPES, DONE_STATES } = require('../constants.js');
const { scoreHealth } = require('../health-scorer.js');
const { detectBottlenecks } = require('../bottleneck-detector.js');
const { esc } = require('../suggestions-engine.js');
const { renderUnestimatedBanner } = require('./widgets.js');

// ---------------------------------------------------------------------------
// renderTeamOverview— person cards with health, velocity, and bottlenecks
// ---------------------------------------------------------------------------

function renderTeamOverview(groupPeople, uiState, appData) {
  const healthRank = { critical: 0, alert: 1, warning: 2, stale: 3, ok: 4 };
  const GROUP_LABELS = { 'my-team': 'My Team', 'peer-group': 'Peer Group', 'other': 'Other' };
  const rosterMap = appData.roster || {};
  const velocityPrev = appData.velocityPrev || {};

  const { banner: unestBanner, counts: unestCounts } = renderUnestimatedBanner(groupPeople);

  const cards = groupPeople.map(p => {
    const roster = rosterMap[p.name] || {};
    const bns = detectBottlenecks(p).filter(b => b.severity === 'high' || b.severity === 'medium');
    const items = p.items;
    const activeCount = items.filter(i => i.state === 'Active').length;
    const newCount = items.filter(i => i.state === 'New' || i.state === 'Ready to Code').length;
    const doneCount = items.filter(i => DONE_STATES.has(i.state)).length;
    const curPts = items.reduce((s, i) => s + (i.storyPoints || 0), 0);
    const lastVel = velocityPrev[p.name];
    let worst = 'ok';
    for (const item of items) { const h = scoreHealth(item); if (healthRank[h] < healthRank[worst]) worst = h; }
    return { person: p, roster, bns, total: items.length, activeCount, newCount, doneCount, curPts, lastVel, worst };
  });

  cards.sort((a, b) => {
    if (b.bns.length !== a.bns.length) return b.bns.length - a.bns.length;
    return b.total - a.total;
  });

  const totalItems = cards.reduce((s, c) => s + c.total, 0);
  const totalBn = cards.reduce((s, c) => s + c.bns.length, 0);
  const label = GROUP_LABELS[uiState.activeGroup] || uiState.activeGroup;

  const headerHtml = `<div class="team-overview-header">
    <h2>${esc(label)} <span class="overview-subtitle" title="Team overview showing each person's workload, health status, and bottlenecks. Person cards are sorted by bottleneck count. Click any card to drill into their work items.">ℹ️</span></h2>
    <span class="team-overview-stats">${totalItems} items${totalBn ? `, <span style="color:var(--red)">${totalBn} bottleneck${totalBn > 1 ? 's' : ''}</span>` : ''}</span>
  </div>`;

  const cardsHtml = cards.map(c => {
    const { person, roster, bns, total, activeCount, newCount, doneCount, curPts, lastVel, worst } = c;
    const t = total || 1;
    const greenPct = Math.round(doneCount / t * 100);
    const bluePct = Math.round(activeCount / t * 100);
    const grayPct = Math.max(0, 100 - greenPct - bluePct);

    let velHtml = '';
    if (lastVel) {
      const delta = curPts - lastVel.points;
      const trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      const arrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
      velHtml = `<span class="card-vel ${trend}">${arrow} ${delta > 0 ? '+' : ''}${delta}</span>`;
    }
    const bnHtml = bns.length ? `<span class="card-bn">⚠ ${bns.length}</span>` : '';
    const uc = unestCounts[person.name] || 0;
    const unestHtml = uc > 0 ? `<span class="unestimated-badge">${uc} unest.</span>` : '';
    const noteHtml = roster.note ? `<span class="stl-badge">${esc(roster.note)}</span>` : '';

    return `<div class="person-card${bns.length ? ' has-bottleneck' : ''}" data-action="select-person" data-name="${esc(person.name)}">
      <div class="card-top">
        <span class="card-name"><span class="health-dot ${worst}"></span>${esc(person.name)}</span>
        ${noteHtml}
        <span class="card-badges">${velHtml}${bnHtml}${unestHtml}</span>
      </div>
      <div class="card-stats">
        <span><b>${total}</b> items (<b>${activeCount}</b> active)</span>
        ${curPts ? `<span><b>${curPts}</b> pts</span>` : ''}
      </div>
      <div class="state-bar" title="Progress bar: green = Resolved/Closed (${doneCount}), blue = Active/in-progress (${activeCount}), gray = New/not started (${newCount}). Click to see this person's full plate.">
        <div class="state-bar-seg green" style="width:${greenPct}%"></div>
        <div class="state-bar-seg blue" style="width:${bluePct}%"></div>
        <div class="state-bar-seg gray" style="width:${grayPct}%"></div>
      </div>
    </div>`;
  }).join('');

  return headerHtml + unestBanner + `<div class="team-grid">${cardsHtml}</div>`;
}

// ---------------------------------------------------------------------------
// renderHygieneOverview — sprint hygiene metrics per person
// ---------------------------------------------------------------------------

function renderHygieneOverview(people, appData) {
  const rows = people.filter(p => p.name !== 'Unassigned').map(p => {
    const excluded = new Set(['Closed', 'Removed']);
    const counts = { past: 0, future: 0, period: 0, backlog: 0 };
    for (const item of p.items) {
      if (excluded.has(item.state)) continue;
      if (!SPRINT_TYPES.has(item.type)) continue;
      const cat = item.sprintCategory;
      if (cat === 'past' || cat === 'previous') counts.past++;
      else if (cat === 'future') counts.future++;
      else if (cat === 'period') counts.period++;
      else if (cat === 'backlog') counts.backlog++;
    }
    const total = counts.past + counts.future + counts.period + counts.backlog;
    return { name: p.name, ...counts, total };
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total);

  if (!rows.length) return '';

  const rowsHtml = rows.map(r => {
    const badges = [];
    if (r.past) badges.push(`<span class="ho-badge ho-past" title="${r.past} item(s) in past sprints — close or move forward">${r.past} past</span>`);
    if (r.future) badges.push(`<span class="ho-badge ho-future" title="${r.future} item(s) in future sprints — remove assignment until sprint starts">${r.future} future</span>`);
    if (r.period) badges.push(`<span class="ho-badge ho-period" title="${r.period} item(s) at period level">${r.period} period</span>`);
    if (r.backlog) badges.push(`<span class="ho-badge ho-backlog" title="${r.backlog} item(s) with no sprint assigned">${r.backlog} unassigned</span>`);

    return `<div class="ho-row" data-action="select-person" data-name="${esc(r.name)}">
      <span class="ho-name">${esc(r.name)}</span>
      <span class="ho-total">${r.total}</span>
      <span class="ho-badges">${badges.join('')}</span>
    </div>`;
  }).join('');

  const totalItems = rows.reduce((s, r) => s + r.total, 0);
  return `<div class="hygiene-overview collapsed" data-action="toggle-collapse-ho">>
    <h3>🧹 Sprint Hygiene 
      <span class="ho-info" title="Items assigned to people but NOT in the current sprint. Past sprint items should be closed. Future sprint items should have assignments removed. Click a person to see details and take action.">ℹ️</span>
      <span class="ho-count">${totalItems} items need attention</span>
      <span class="section-toggle">▶</span>
    </h3>
    <div class="section-body">
      <div class="ho-header"><span>Person</span><span>Count</span><span>Categories</span></div>
      ${rowsHtml}
    </div>
  </div>`;
}

module.exports = { renderTeamOverview, renderHygieneOverview };
