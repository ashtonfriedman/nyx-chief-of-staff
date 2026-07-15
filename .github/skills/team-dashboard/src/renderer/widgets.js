// src/renderer/widgets.js — Standalone widget blocks: stale PRs, unestimated banner, suggestions panel.
// Extracted from team-dashboard.js (monolith lines 252–258, 1294–1336, 1635–1700).
// No globals — all data via parameters or state.js imports.
"use strict";

const { generateSuggestions, esc } = require('../suggestions-engine.js');
const { ADO_PR_BASE } = require('../constants.js');
const { daysBetween } = require('../health-scorer.js');

// --- Stale PR helpers ---

/**
 * Return active PRs older than thresholdDays, sorted oldest-first.
 * Pure function — no global reads.
 */
function getStalePrs(activePRs, thresholdDays) {
  if (!activePRs || !activePRs.length) return [];
  const now = new Date();
  return activePRs
    .map(pr => ({ ...pr, ageDays: pr.createdDate ? daysBetween(new Date(pr.createdDate), now) : 0 }))
    .filter(pr => pr.ageDays >= thresholdDays)
    .sort((a, b) => b.ageDays - a.ageDays);
}

/**
 * Age-tier CSS class for a stale PR.
 */
function stalePrAgeClass(days) {
  if (days >= 180) return 'extreme';
  if (days >= 90) return 'old';
  return 'moderate';
}

/**
 * Render a single stale PR row.
 * @param {Object} pr - PR object with ageDays already computed
 * @param {boolean} showAuthor - whether to show the author column
 * @param {Object} roster - map of person names to roster entries
 */
function renderStalePrRow(pr, showAuthor, roster) {
  const truncTitle = pr.title.length > 55 ? pr.title.slice(0, 52) + '…' : pr.title;
  const prUrl = `${ADO_PR_BASE}${pr.prId}`;
  const isOffTeam = !roster[pr.createdBy];
  const offTeamBadge = isOffTeam ? '<span class="off-team-badge">external</span>' : '';
  const authorCol = showAuthor ? `<span class="spr-author">${esc(pr.createdBy)}${offTeamBadge}</span>` : '';
  return `<div class="stale-pr-row">
    ${authorCol}
    <span class="spr-title"><a href="${prUrl}" target="_blank" title="${esc(pr.title)}">${esc(truncTitle)}</a></span>
    <span class="spr-repo">${esc(pr.repo)}</span>
    <span class="spr-age ${stalePrAgeClass(pr.ageDays)}">${pr.ageDays}d</span>
    <span class="spr-link"><a href="${prUrl}" target="_blank" title="Open PR">↗</a></span>
  </div>`;
}

/**
 * Render the full stale PR banner for the team view.
 * @param {Object} appData - application data (activePRs, roster)
 * @param {Object} uiState - UI state (stalePrThresholdDays)
 */
function renderStalePrBanner(appData, uiState) {
  const stale = getStalePrs(appData.activePRs, uiState.stalePrThresholdDays);
  if (!stale.length) return '';
  const oldest = stale[0].ageDays;
  const count30_89 = stale.filter(pr => pr.ageDays >= 30 && pr.ageDays < 90).length;
  const count90_179 = stale.filter(pr => pr.ageDays >= 90 && pr.ageDays < 180).length;
  const count180plus = stale.filter(pr => pr.ageDays >= 180).length;
  const tierHtml = `<div class="pr-tier-summary">
    ${count30_89 ? `<span class="tier-badge moderate">${count30_89} PR${count30_89 > 1 ? 's' : ''} 30-89d</span>` : ''}
    ${count90_179 ? `<span class="tier-badge old">${count90_179} PR${count90_179 > 1 ? 's' : ''} 90-179d</span>` : ''}
    ${count180plus ? `<span class="tier-badge extreme">${count180plus} PR${count180plus > 1 ? 's' : ''} 180d+</span>` : ''}
  </div>`;
  return `<div class="stale-pr-banner" title="Pull requests open longer than 30 days. These accumulate merge debt and should be completed, closed, or reassigned. Tiered by age: 30-89d moderate, 90-179d old, 180d+ extreme.">
    <span class="stale-pr-icon">🔴</span>
    <span><b>${stale.length} stale PR${stale.length > 1 ? 's' : ''}</b> — oldest: ${oldest}d</span>
    <button data-action="toggle-stale-prs">Show</button>
  </div>
  ${tierHtml}
  <div class="stale-pr-list hidden">
    ${stale.map(pr => renderStalePrRow(pr, true, appData.roster)).join('')}
  </div>`;
}

/**
 * Render stale PRs for a specific person.
 * @param {string} personName
 * @param {Object} appData - application data (activePRs, roster)
 * @param {Object} uiState - UI state (stalePrThresholdDays)
 */
function renderPersonStalePrs(personName, appData, uiState) {
  const stale = getStalePrs(appData.activePRs, uiState.stalePrThresholdDays)
    .filter(pr => pr.createdBy === personName);
  if (!stale.length) return '';
  return `<div class="person-stale-prs">
    <h4>🔴 ${stale.length} Stale PR${stale.length > 1 ? 's' : ''}</h4>
    ${stale.map(pr => renderStalePrRow(pr, false, appData.roster)).join('')}
  </div>`;
}

// --- Unestimated items banner ---

/**
 * Render the unestimated items warning banner.
 * @param {Array} people - array of person objects with items
 * @returns {{ banner: string, counts: Object }}
 */
function renderUnestimatedBanner(people) {
  const excluded = new Set(['Closed', 'Removed']);
  const unestByPerson = {};
  for (const p of people) {
    const unest = p.items.filter(i => !excluded.has(i.state) && !i.storyPoints);
    if (unest.length) {
      const types = {};
      for (const i of unest) types[i.type] = (types[i.type] || 0) + 1;
      unestByPerson[p.name] = { count: unest.length, types };
    }
  }
  const entries = Object.entries(unestByPerson);
  if (!entries.length) return { banner: '', counts: {} };

  const totalUnest = entries.reduce((s, [, v]) => s + v.count, 0);
  const personCount = entries.length;
  const severity = totalUnest >= 10 ? ' warning' : '';

  const rows = entries
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, { count, types }]) => {
      const typeSummary = Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', ');
      return `<tr><td class="ud-person" data-action="select-person" data-name="${esc(name)}">${esc(name)}</td><td>${count}</td><td>${esc(typeSummary)}</td></tr>`;
    }).join('');

  const banner = `<div class="unestimated-banner${severity}" id="unest-banner">
    <div class="ub-summary" title="Items without story points (effort estimate). Unestimated items can't be used for velocity tracking or sprint forecasting. Story points = dev days for stories/bugs.">
      <span>⚠ <b>${totalUnest}</b> unestimated item${totalUnest !== 1 ? 's' : ''} across <b>${personCount}</b> ${personCount === 1 ? 'person' : 'people'}</span>
      <span>
        <span class="ub-toggle" data-action="toggle-unest-details">Show Details</span>
        <span class="ub-dismiss" data-action="dismiss-banner" title="Dismiss">✕</span>
      </span>
    </div>
    <div class="unestimated-details" id="unest-details">
      <table><thead><tr><th>Person</th><th>Count</th><th>Types</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
  </div>`;

  const counts = {};
  for (const [name, { count }] of entries) counts[name] = count;
  return { banner, counts };
}

// --- Suggestions panel ---

/**
 * Render the collapsible suggestions panel.
 * @param {Array} people - person objects
 * @param {Object} appData - application data (activePRs, sprint)
 * @param {Object} uiState - UI state (stalePrThresholdDays)
 */
function renderSuggestionsPanel(people, appData, uiState) {
  const prs = appData.activePRs || [];
  const ctx = {
    SPRINT: appData.sprint,
    STALE_PR_THRESHOLD_DAYS: uiState.stalePrThresholdDays,
  };
  const suggestions = generateSuggestions(people, prs, ctx);
  if (!suggestions.length) return '';
  const items = suggestions.map(s => `<li>${s.icon} ${s.text}</li>`).join('');
  return `<div class="suggestions-panel collapsed" data-action="toggle-collapse"><h3>▶ Suggested Actions <span class="collapse-hint">(${suggestions.length})</span></h3><ul>${items}</ul></div>`;
}

module.exports = {
  getStalePrs,
  stalePrAgeClass,
  renderStalePrRow,
  renderStalePrBanner,
  renderPersonStalePrs,
  renderUnestimatedBanner,
  renderSuggestionsPanel,
};
