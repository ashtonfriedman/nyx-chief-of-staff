// src/renderer/person-closure.js — Sprint closure readiness view.
// Extracted from person.js for maintainability.
"use strict";

const { typeClass, renderDetailPanel } = require('./items.js');
const { daysBetween } = require('../health-scorer.js');
const { esc } = require('../suggestions-engine.js');
const { ADO_BASE, DONE_STATES } = require('../constants.js');

// ---------------------------------------------------------------------------
// renderClosureView(person, appData)
// ---------------------------------------------------------------------------
function renderClosureView(person, appData) {
  const sprint = appData.sprint || {};
  const velocityPrev = appData.velocityPrev || {};
  const activePRs = appData.activePRs || [];
  const carryOver = appData.carryOver || [];

  const items = person.items;
  const atRisk = items.filter(i => i.state === 'New' || i.state === 'Active');
  const completed = items.filter(i => DONE_STATES.has(i.state));
  const totalCount = items.length;
  const doneCount = completed.length;
  const totalPts = items.reduce((s, i) => s + (i.storyPoints || 0), 0);
  const donePts = completed.reduce((s, i) => s + (i.storyPoints || 0), 0);
  const pct = totalCount ? Math.round(doneCount / totalCount * 100) : 0;

  // Sprint Completion Forecast
  const now = new Date();
  const remainingItems = atRisk.length;
  const lastVel = velocityPrev[person.name];
  const lastRate = lastVel?.items ?? 0;
  const sprintDaysLeft = Math.max(0, (sprint.days || 14) - daysBetween(sprint.start, now));
  const dailyRate = lastRate > 0 ? lastRate / (sprint.days || 14) : 0;
  const projectedCompletion = dailyRate > 0 ? remainingItems / dailyRate : Infinity;
  const forecastClass = projectedCompletion <= sprintDaysLeft ? 'on-track'
    : projectedCompletion <= sprintDaysLeft + 2 ? 'at-risk' : 'behind';
  const forecastHtml = lastRate > 0 ? `<div class="forecast-card ${forecastClass}">
    <div class="forecast-label">Sprint Forecast</div>
    <div class="forecast-value">${projectedCompletion === Infinity ? '∞' : projectedCompletion.toFixed(1)}d needed / ${sprintDaysLeft}d left</div>
    <div class="forecast-detail">Based on ${lastRate} items/sprint · ${dailyRate.toFixed(1)} items/day</div>
  </div>` : '';

  // Sprint Closure Readiness Checklist
  const allItemsResolved = atRisk.length === 0;
  const personPRs = activePRs.filter(pr => pr.createdBy === person.name);
  const noPRsOpen = personPRs.length === 0;
  const personCarryOvers = person.items.filter(i => carryOver.includes(i.id));
  const noCarryOvers = personCarryOvers.length === 0;
  const storyPointsComplete = totalPts > 0 ? donePts >= totalPts : true;
  const checklistHtml = `<div class="closure-checklist">
    <div class="check-item ${allItemsResolved ? 'pass' : 'fail'}">${allItemsResolved ? '✅' : '❌'} All sprint items resolved</div>
    <div class="check-item ${noPRsOpen ? 'pass' : 'fail'}">${noPRsOpen ? '✅' : '❌'} No open PRs from sprint work</div>
    <div class="check-item ${noCarryOvers ? 'pass' : 'fail'}">${noCarryOvers ? '✅' : '❌'} No carry-over items</div>
    <div class="check-item ${storyPointsComplete ? 'pass' : 'fail'}">${storyPointsComplete ? '✅' : '❌'} Story points: ${donePts}/${totalPts}</div>
  </div>`;

  // Summary line
  const summaryHtml = `<div class="closure-summary">
    <span>${doneCount} of ${totalCount} items closed (${donePts} pts of ${totalPts} pts)</span>
    <div class="closure-bar"><div class="closure-fill" style="width:${pct}%"></div></div>
    <span style="font-weight:600;color:${pct >= 80 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)'}">${pct}%</span>
  </div>`;

  // Closure row
  function closureRow(item) {
    const pr = item.prCount || item.linkedPRs?.length || 0;
    let flag = '';
    if (item.state === 'New') flag = '<span class="risk-flag not-started">Not Started</span>';
    else if (item.state === 'Active' && pr === 0) flag = '<span class="risk-flag no-pr">No PR</span>';

    const pts = item.storyPoints != null ? item.storyPoints : '—';

    return `<div class="wi-row parent-row">
      <span class="wi-id"><a href="${ADO_BASE}${item.id}" target="_blank">${item.id}</a></span>
      <span><span class="wi-type ${typeClass(item.type)}">${item.type}</span></span>
      <span class="wi-title">${esc(item.title)}${flag}</span>
      <span><span class="state-dot ${item.state.toLowerCase().replace(/\s/g, '')}"></span>${item.state}</span>
      <span>${pts}</span>
      <span></span>
      <span></span>
    </div>`;
  }

  // At Risk section
  const riskSorted = [...atRisk].sort((a, b) => {
    const so = { New: 0, Active: 1 };
    return (so[a.state] ?? 9) - (so[b.state] ?? 9) || (a.priority || 9) - (b.priority || 9);
  });
  let riskHtml = '';
  if (riskSorted.length) {
    riskHtml = `<div class="closure-section" data-action="toggle-collapse">
      <div class="closure-section-hdr"><span class="chevron">▼</span> At Risk — ${riskSorted.length} items</div>
      <div class="wi-header">
        <span>ID</span><span>Type</span><span>Title</span><span>State</span><span>Pts</span><span></span><span></span>
      </div>
      ${riskSorted.map(i => `<div class="wi-group">${closureRow(i)}${renderDetailPanel(i, { activePRs: appData.activePRs || [] })}</div>`).join('')}
    </div>`;
  } else {
    riskHtml = '<div class="closure-section"><div class="closure-section-hdr">✓ No at-risk items — all work resolved!</div></div>';
  }

  // Completed section
  const completeHtml = `<div class="closure-section" data-action="toggle-collapse">
    <div class="closure-section-hdr"><span class="chevron">▼</span> Completed — ${doneCount} items, <b style="color:var(--green)">${donePts} pts</b></div>
    ${completed.length ? `<div class="wi-header">
      <span>ID</span><span>Type</span><span>Title</span><span>State</span><span>Pts</span><span></span><span></span>
    </div>
    ${completed.map(i => {
      const pts = i.storyPoints != null ? i.storyPoints : '—';
      return `<div class="wi-group"><div class="wi-row parent-row">
        <span class="wi-id"><a href="${ADO_BASE}${i.id}" target="_blank">${i.id}</a></span>
        <span><span class="wi-type ${typeClass(i.type)}">${i.type}</span></span>
        <span class="wi-title">${esc(i.title)}</span>
        <span><span class="state-dot ${i.state.toLowerCase().replace(/\s/g, '')}"></span>${i.state}</span>
        <span>${pts}</span>
        <span></span>
        <span></span>
      </div>${renderDetailPanel(i, { activePRs: appData.activePRs || [] })}</div>`;
    }).join('')}` : '<div class="closure-done-stat">No completed items yet.</div>'}
  </div>`;

  return forecastHtml + checklistHtml + summaryHtml + riskHtml + completeHtml;
}

module.exports = { renderClosureView };
