// src/renderer/person-sprint.js — Sprint hygiene and 1:1 talking points.
// Extracted from person.js for maintainability.
"use strict";

const { typeClass } = require('./items.js');
const { scoreHealth, businessDays, daysBetween } = require('../health-scorer.js');
const { esc } = require('../suggestions-engine.js');
const { ADO_BASE, SPRINT_TYPES, DONE_STATES } = require('../constants.js');

// ---------------------------------------------------------------------------
// renderSprintHygiene(person, appData)
// ---------------------------------------------------------------------------
function renderSprintHygiene(person, appData) {
  const excluded = new Set(['Closed', 'Removed']);
  const outItems = person.items.filter(i =>
    SPRINT_TYPES.has(i.type) && i.sprintCategory !== 'current' && !excluded.has(i.state)
  );
  if (!outItems.length) return '';

  const groups = {
    past:     { label: '⏪ Past Sprint',       action: 'Close or move forward',                  cls: 'hygiene-past',     items: [] },
    previous: { label: '⏪ Previous Sprint',    action: 'Close or move to current',               cls: 'hygiene-past',     items: [] },
    future:   { label: '⏩ Future Sprint',      action: 'Remove assignment until sprint starts',   cls: 'hygiene-future',   items: [] },
    period:   { label: '📁 Period Backlog',     action: 'OK if parked — flag if Active',           cls: 'hygiene-period',   items: [] },
    backlog:  { label: '📦 No Sprint Assigned', action: 'Assign to sprint or unassign person',     cls: 'hygiene-backlog',  items: [] },
  };

  for (const item of outItems) {
    const cat = item.sprintCategory || 'backlog';
    if (groups[cat]) groups[cat].items.push(item);
  }

  let html = `<div class="sprint-hygiene collapsed" data-action="toggle-collapse" data-target=".sprint-hygiene">>
    <h3>🧹 Sprint Hygiene <span class="hygiene-count">${outItems.length} items outside current sprint</span> <span class="section-toggle">▶</span></h3>
    <div class="section-body">`;

  for (const [cat, group] of Object.entries(groups)) {
    if (!group.items.length) continue;
    const activeInGroup = group.items.filter(i => i.state === 'Active').length;
    const activeWarning = activeInGroup > 0 ? ` <span class="hygiene-active-warn">⚠ ${activeInGroup} Active</span>` : '';

    html += `<div class="hygiene-group ${group.cls}">
      <div class="hygiene-group-header">
        <span>${group.label} (${group.items.length})${activeWarning}</span>
        <span class="hygiene-action">${group.action}</span>
      </div>
      <div class="hygiene-items">`;

    for (const item of group.items.sort((a, b) => (a.state === 'Active' ? 0 : 1) - (b.state === 'Active' ? 0 : 1))) {
      const pts = item.storyPoints != null ? `${item.storyPoints}pts` : '';
      const stateClass = item.state.toLowerCase().replace(/\s/g, '');
      const daysInState = item.age?.sinceStateChange != null ? `${Math.round(item.age.sinceStateChange)}d` : '';
      const iterShort = item.iteration ? item.iteration.split('\\').pop() : 'none';

      html += `<div class="hygiene-item">
        <a href="${ADO_BASE}${item.id}" target="_blank" class="hygiene-id">#${item.id}</a>
        <span class="wi-type ${item.type.toLowerCase().replace(/\s/g, '')}">${item.type}</span>
        <span class="hygiene-title" title="${esc(item.title)}">${esc(item.title.length > 50 ? item.title.slice(0, 47) + '…' : item.title)}</span>
        <span class="state-dot ${stateClass}"></span><span>${item.state}</span>
        <span class="hygiene-meta">${pts} ${daysInState} ${esc(iterShort)}</span>
      </div>`;
    }

    html += `</div></div>`;
  }

  html += `</div></div>`;
  return html;
}

// ---------------------------------------------------------------------------
// renderTalkingPoints(person, appData)
// ---------------------------------------------------------------------------
function renderTalkingPoints(person, appData) {
  const roster = (appData.roster || {})[person.name] || {};
  if (roster.group !== 'my-team' || roster.rel !== 'direct') return '';

  const sprint = appData.sprint || {};
  const velocityPrev = appData.velocityPrev || {};
  const carryOver = appData.carryOver || [];
  const items = person.items;
  const points = [];

  function tpItem(it, extra) {
    const short = it.title.length > 55 ? it.title.slice(0, 52) + '…' : it.title;
    const pts = it.storyPoints != null ? `<span class="tp-pts">${it.storyPoints}pts</span>` : '';
    const blockedTag = it.tags && it.tags.toUpperCase().includes('BLOCKED') ? '<span class="tp-blocked-tag">BLOCKED</span>' : '';
    const comments = it.commentCount > 0 ? `<span class="tp-comments">💬${it.commentCount}</span>` : '<span class="tp-no-comments">no comments</span>';
    return `<div class="tp-item"><a href="${ADO_BASE}${it.id}" target="_blank">#${it.id}</a> <span class="wi-type ${typeClass(it.type)}">${it.type}</span> ${esc(short)} ${pts} ${blockedTag} ${comments} ${extra || ''}</div>`;
  }

  // 1. Wins
  const closed = items.filter(i => DONE_STATES.has(i.state));
  if (closed.length) {
    const closedPts = closed.reduce((s, i) => s + (i.storyPoints || 0), 0);
    const ptsStr = closedPts > 0 ? ` (${closedPts} pts)` : '';
    points.push({ cls: 'tp-win', text: `✅ Closed ${closed.length} item${closed.length !== 1 ? 's' : ''}${ptsStr}`,
      detail: closed.map(i => tpItem(i)).join('') });
  }

  // 2. Stale items
  const stale = items.filter(i => i.state === 'Active' && (i.age?.sinceActivated || 0) > 7);
  if (stale.length) {
    points.push({ cls: 'tp-warn', text: `⏳ ${stale.length} item${stale.length !== 1 ? 's' : ''} active 7+ days`,
      detail: stale.map(it => {
        const d = Math.round(it.age.sinceActivated);
        return tpItem(it, `<span class="tp-age">${d}d active</span>`);
      }).join('') });
  }

  // 3. No linked PR
  const PR_TYPES = new Set(['User Story', 'Bug', 'Task']);
  const noPr = items.filter(i => i.state === 'Active' && PR_TYPES.has(i.type) && i.prCount === 0 && (i.age?.sinceActivated || 0) > 3);
  if (noPr.length) {
    points.push({ cls: 'tp-risk', text: `🔴 ${noPr.length} Active item${noPr.length !== 1 ? 's' : ''} with no linked PR`,
      detail: noPr.map(it => {
        const d = Math.round(it.age?.sinceActivated || 0);
        return tpItem(it, `<span class="tp-age">${d}d, no PR</span>`);
      }).join('') });
  }

  // 4. Silent items
  const silent = items.filter(i => i.state === 'Active' && i.commentCount === 0 && i.age?.sinceChanged > 3);
  if (silent.length) {
    points.push({ cls: 'tp-risk', text: `🔇 ${silent.length} Active item${silent.length !== 1 ? 's' : ''} with zero discussion`,
      detail: silent.map(it => {
        const d = it.age?.sinceChanged ? Math.round(it.age.sinceChanged) : '?';
        return tpItem(it, `<span class="tp-age">last change ${d}d ago</span>`);
      }).join('') });
  }

  // 5. Blocked items
  const blockedItems = items.filter(i => i.tags && i.tags.toUpperCase().includes('BLOCKED') && i.state !== 'Closed' && i.state !== 'Removed');
  if (blockedItems.length) {
    points.push({ cls: 'tp-risk', text: `🚫 ${blockedItems.length} item${blockedItems.length !== 1 ? 's' : ''} tagged BLOCKED`,
      detail: blockedItems.map(it => tpItem(it)).join('') });
  }

  // 6. Velocity delta
  const sprintPts = items.reduce((s, i) => s + (i.storyPoints || 0), 0);
  const lastVel = velocityPrev[person.name];
  const lastPts = lastVel?.points ?? null;
  if (lastPts != null) {
    const delta = sprintPts - lastPts;
    const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
    points.push({ cls: 'tp-info', text: `📊 ${sprintPts} pts this sprint vs ${lastPts} pts last sprint (${arrow}${delta > 0 ? '+' : ''}${delta})` });
  }

  // 7. Overload check
  const activeStoriesBugs = items.filter(i => (i.type === 'User Story' || i.type === 'Bug') && i.state === 'Active');
  if (activeStoriesBugs.length > 3) {
    points.push({ cls: 'tp-warn', text: `🔄 ${activeStoriesBugs.length} stories/bugs Active simultaneously — high WIP`,
      detail: activeStoriesBugs.map(it => {
        const d = it.age?.sinceActivated ? Math.round(it.age.sinceActivated) : '?';
        return tpItem(it, `<span class="tp-age">${d}d active</span>`);
      }).join('') });
  }

  // 8. Unestimated work
  const unestimated = items.filter(i => !i.storyPoints && !DONE_STATES.has(i.state) && i.type !== 'Task');
  if (unestimated.length) {
    points.push({ cls: 'tp-warn', text: `📏 ${unestimated.length} item${unestimated.length !== 1 ? 's' : ''} with no story points`,
      detail: unestimated.map(it => tpItem(it)).join('') });
  }

  // 9. Sprint closure — flag New items when sprint >80% done
  const sprintDay = daysBetween(sprint.start, new Date());
  const sprintPct = Math.min(100, Math.round(sprintDay / (sprint.days || 14) * 100));
  if (sprintPct >= 80) {
    const newItems = items.filter(i => i.state === 'New');
    const daysLeft = Math.max(0, (sprint.days || 14) - sprintDay);
    if (newItems.length) {
      points.push({ cls: 'tp-risk', text: `⏰ ${newItems.length} item${newItems.length !== 1 ? 's' : ''} still New with ${daysLeft}d left in sprint`,
        detail: newItems.map(it => tpItem(it)).join('') });
    }
  }

  // 10. Carry-over items
  if (carryOver.length) {
    const carryItems = items.filter(i => carryOver.includes(i.id));
    if (carryItems.length) {
      points.push({ cls: 'tp-warn', text: `⚠️ ${carryItems.length} carry-over${carryItems.length !== 1 ? 's' : ''} from last sprint`,
        detail: carryItems.map(it => tpItem(it)).join('') });
    }
  }

  if (!points.length) return '';

  const lis = points.map(p => {
    const detail = p.detail ? `<div class="tp-detail">${p.detail}</div>` : '';
    return `<li class="${p.cls}"><div class="tp-summary">${p.text}</div>${detail}</li>`;
  }).join('');
  return `<div class="talking-points collapsed" title="Auto-generated 1:1 talking points based on this person's work item patterns. Each point lists the specific items so you can discuss them directly.">
    <h3 data-action="toggle-collapse" data-target=".talking-points">💬 1:1 Talking Points <span class="tp-count">${points.length}</span> <span class="section-toggle">▶</span></h3>
    <ul>${lis}</ul>
  </div>`;
}

module.exports = { renderSprintHygiene, renderTalkingPoints };
