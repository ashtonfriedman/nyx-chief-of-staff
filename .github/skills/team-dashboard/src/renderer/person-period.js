// src/renderer/person-period.js — Period risk view.
// Extracted from person.js for maintainability.
"use strict";

const { daysBetween } = require('../health-scorer.js');
const { esc } = require('../suggestions-engine.js');
const { ADO_BASE, DONE_STATES } = require('../constants.js');

// ---------------------------------------------------------------------------
// renderPeriodView(person, appData)
// ---------------------------------------------------------------------------
function renderPeriodView(person, appData) {
  const period = appData.period || {};
  const velocityPrev = appData.velocityPrev || {};
  const currentData = appData.currentData;

  const now = new Date();
  const periodTotal = daysBetween(period.start, period.end);
  const periodElapsed = daysBetween(period.start, now);
  const periodRemaining = Math.max(0, daysBetween(now, period.end));
  const periodPct = Math.min(100, Math.max(0, Math.round(periodElapsed / periodTotal * 100)));
  const barColor = periodRemaining <= 7 ? 'var(--red)' : periodRemaining <= 14 ? 'var(--yellow)' : 'var(--purple)';

  // Collect items — if person is null, use all people (team overview)
  const allItems = person ? person.items : currentData.people.flatMap(p => p.items);

  // Build a lookup of all items by ID for child resolution
  const byId = {};
  for (const p of currentData.people) for (const i of p.items) byId[i.id] = i;

  // Features
  const features = allItems.filter(i => i.type === 'Feature');
  const atRiskFeatures = features.filter(f => f.state === 'Active' || f.state === 'New');
  const completedFeatures = features.filter(f => DONE_STATES.has(f.state));

  // For each feature, find child items across ALL people's items
  const allTeamItems = currentData.people.flatMap(p => p.items);
  function childrenOf(featureId) {
    return allTeamItems.filter(i => i.parent === featureId && i.id !== featureId);
  }

  // Period velocity context
  const lastSprintPts = Object.values(velocityPrev).reduce((s, v) => s + (v.points || 0), 0);
  const personVel = person && velocityPrev[person.name];
  const velPts = person ? (personVel?.points ?? 0) : lastSprintPts;
  const remainingFeaturePts = atRiskFeatures.reduce((s, f) => s + (f.storyPoints || 0), 0);
  const sprintsLeft = Math.max(1, Math.ceil(periodRemaining / 14));

  // Header
  const headerHtml = `<div class="period-header">
    <div class="per-title"><span class="per-name">${esc(period.name)}</span> ends ${period.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — <b>${periodRemaining} days remaining</b></div>
    <div class="period-progress"><div class="per-fill" style="width:${periodPct}%;background:${barColor}"></div></div>
    <div class="per-days">${periodPct}% elapsed · ${sprintsLeft} sprint${sprintsLeft !== 1 ? 's' : ''} left</div>
  </div>`;

  // Velocity context
  const velocityHtml = velPts > 0 ? `<div class="period-velocity-ctx">
    At current pace: <b>${velPts} pts/sprint</b>.
    ${remainingFeaturePts > 0
      ? `Need <b>${remainingFeaturePts} pts</b> to close remaining features (${atRiskFeatures.length}).`
      : 'All feature points resolved.'}
  </div>` : '';

  // Feature risk cards
  function featureCard(f) {
    const children = childrenOf(f.id);
    const totalChildren = children.length;
    const doneChildren = children.filter(c => DONE_STATES.has(c.state)).length;
    const childPct = totalChildren > 0 ? Math.round(doneChildren / totalChildren * 100) : 0;
    const pts = f.storyPoints != null ? `${f.storyPoints} pts` : '—';

    let riskClass = 'risk-green', riskLabel = 'On Track';
    if (totalChildren > 0) {
      if (childPct < 50 && periodRemaining < 12) { riskClass = 'risk-red'; riskLabel = 'High Risk'; }
      else if (childPct < 75) { riskClass = 'risk-yellow'; riskLabel = 'At Risk'; }
    } else if (f.state === 'New') {
      riskClass = 'risk-red'; riskLabel = 'Not Started';
    } else if (f.state === 'Active') {
      riskClass = 'risk-yellow'; riskLabel = 'No Children';
    }

    const childBarHtml = totalChildren > 0
      ? `<div class="frc-children">
          ${doneChildren} of ${totalChildren} child items closed
          <div class="child-bar"><div class="child-fill" style="width:${childPct}%;background:${childPct >= 75 ? 'var(--green)' : childPct >= 50 ? 'var(--yellow)' : 'var(--red)'}"></div></div>
          ${childPct}%
        </div>`
      : `<div class="frc-children" style="color:var(--text-muted)">No child items linked</div>`;

    return `<div class="feature-risk-card">
      <div class="frc-top">
        <span class="frc-id"><a href="${ADO_BASE}${f.id}" target="_blank">#${f.id}</a></span>
        <span class="frc-title">${esc(f.title)}</span>
        <span class="frc-state"><span class="state-dot ${f.state.toLowerCase().replace(/\s/g, '')}"></span>${f.state}</span>
        <span class="frc-pts">${pts}</span>
        <span class="frc-risk ${riskClass}">${riskLabel}</span>
      </div>
      ${childBarHtml}
    </div>`;
  }

  // At-risk features section
  const riskSorted = [...atRiskFeatures].sort((a, b) => (a.priority || 9) - (b.priority || 9));
  let riskHtml = '';
  if (riskSorted.length) {
    riskHtml = `<div class="closure-section" data-action="toggle-collapse">
      <div class="closure-section-hdr"><span class="chevron">▼</span> Features at Risk — ${riskSorted.length}</div>
      ${riskSorted.map(featureCard).join('')}
    </div>`;
  } else {
    riskHtml = '<div class="closure-section"><div class="closure-section-hdr">✓ No features at risk — all resolved!</div></div>';
  }

  // Completed features section
  let completeHtml = '';
  if (completedFeatures.length) {
    completeHtml = `<div class="closure-section" data-action="toggle-collapse">
      <div class="closure-section-hdr"><span class="chevron">▼</span> Completed Features — ${completedFeatures.length} 🎉</div>
      ${completedFeatures.map(featureCard).join('')}
    </div>`;
  } else {
    completeHtml = '<div class="closure-section"><div class="closure-section-hdr" style="color:var(--text-muted)">No features completed yet this period.</div></div>';
  }

  return headerHtml + velocityHtml + riskHtml + completeHtml;
}

module.exports = { renderPeriodView };
