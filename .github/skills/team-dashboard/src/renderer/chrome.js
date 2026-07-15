// src/renderer/chrome.js — Header, summary bar, sprint bar, footer HTML builders.
// Extracted from team-dashboard.js lines ~1504–1548.
"use strict";

/* global PACKAGE_VERSION */
// PACKAGE_VERSION is substituted by esbuild at build time from package.json#version.
// typeof guard makes this file safe to require() in Node without going through the bundle.
const VERSION = typeof PACKAGE_VERSION !== 'undefined' ? PACKAGE_VERSION : 'dev';

const { appData, uiState } = require('../state.js');
const { esc } = require('../suggestions-engine.js');
const { daysBetween } = require('../health-scorer.js');
const { detectBottlenecks } = require('../bottleneck-detector.js');

// --- Local helpers (mirror monolith utilities using state imports) ---

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

// --- Exported builders ---

/**
 * Build the page header: title, live-clock, data-age, sprint nav, refresh button, shortcuts hint.
 * @param {Array} people - All people (used for context, not currently rendered in header)
 * @param {Array} groupPeople - Current group people (used for context)
 * @returns {string} HTML string
 */
function buildHeader(people, groupPeople) {
  const sprintNav = (() => {
    const sel = uiState.availableSprints[uiState.selectedSprintIdx];
    const hasPrev = uiState.selectedSprintIdx > 0;
    const hasNext = uiState.selectedSprintIdx < uiState.availableSprints.length - 1;
    const isCurrent = isViewingCurrentSprint();
    const dateRange = sel ? sel.dateRange : '';
    return '<div class="sprint-nav">'
      + '<button class="sprint-nav-btn" data-action="navigate-sprint" data-dir="-1" '
      + (!hasPrev ? 'disabled' : '') + ' title="Previous sprint">\u2190</button>'
      + '<span class="sprint-nav-label' + (isCurrent ? ' is-current' : '') + '" title="' + dateRange + '">'
      + getSelectedSprintName() + (isCurrent ? ' <span class="current-badge">CURRENT</span>' : '')
      + '</span>'
      + '<button class="sprint-nav-btn" data-action="navigate-sprint" data-dir="1" '
      + (!hasNext ? 'disabled' : '') + ' title="Next sprint">\u2192</button>'
      + '</div>';
  })();

  return `<div class="header">
      <h1>Team Health <span>\u2014 {your-area-path}</span></h1>
      <div class="meta"><span id="live-clock"></span> <span id="data-age" class="data-fresh"></span>
        ${sprintNav}
        <button class="refresh-btn" data-action="refresh" title="Re-run collector and reload data">\u21BB Refresh</button>
        <span id="refresh-timestamp"></span>
        <span id="refresh-status"></span>
        <span class="kbd-hint" data-action="toggle-shortcuts" title="Keyboard shortcuts">\u2328 ?</span></div>
    </div>`;
}

/**
 * Build the summary bar: total items, active, bottlenecks, people count.
 * @param {Array} people - All people
 * @param {Array} groupPeople - Current group people (reserved for future use)
 * @returns {string} HTML string
 */
function buildSummaryBar(people, groupPeople) {
  const totalItems = people.reduce((s, p) => s + p.items.length, 0);
  const activeItems = people.reduce((s, p) => s + p.items.filter(i => i.state === 'Active').length, 0);
  let totalBN = 0, highBN = 0;
  for (const p of people) {
    const bn = detectBottlenecks(p);
    totalBN += bn.length;
    highBN += bn.filter(b => b.severity === 'high').length;
  }
  const peopleCount = people.filter(p => p.name !== 'Unassigned').length;

  return `<div class="summary-bar">
      <div class="s-card" data-action="jump-to-most-loaded" title="Jump to most loaded person"><div class="num">${totalItems}</div><div class="lbl">Total Items</div></div>
      <div class="s-card" data-action="jump-to-most-active" title="Jump to most active items"><div class="num" style="color:var(--accent)">${activeItems}</div><div class="lbl">Active</div></div>
      <div class="s-card ${highBN ? 'alert' : totalBN ? 'warn' : ''}" data-action="jump-to-bottleneck" title="Jump to first bottleneck">
        <div class="num" style="color:${highBN ? 'var(--red)' : totalBN ? 'var(--yellow)' : 'var(--green)'}">${totalBN}</div>
        <div class="lbl">Bottlenecks${highBN ? ` (${highBN} \u26A0)` : ''}</div></div>
      <div class="s-card" data-action="jump-to-most-loaded" title="Jump to most loaded person"><div class="num">${peopleCount}</div><div class="lbl">People</div></div>
    </div>`;
}

/**
 * Build the sprint progress bar.
 * @returns {string} HTML string
 */
function buildSprintBar() {
  const sprint = appData.sprint;
  if (!sprint) return '';
  const sprintDay = daysBetween(sprint.start, new Date());
  const sprintPct = Math.min(100, Math.round(sprintDay / sprint.days * 100));

  return `<div class="sprint-bar">
      <div class="sprint-bg"><div class="sprint-fill ${sprintPct >= 85 ? 'danger' : sprintPct >= 65 ? 'warn' : 'normal'}"
        style="width:${sprintPct}%"></div></div>
      <div class="sprint-labels"><span>${esc(sprint.name)} \u2014 Day ${sprintDay} / ${sprint.days}</span>
        <span>${sprint.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></div>
    </div>`;
}

/**
 * Build the page footer: data timestamp and version.
 * @returns {string} HTML string
 */
function buildFooter() {
  const generatedAt = appData.generatedAt;
  return `<div class="footer">
      <span>Data: ${generatedAt ? new Date(generatedAt).toLocaleString() : 'seed'}</span>
      <span>\u263D the agent \u2014 Team Health v${VERSION}</span>
    </div>`;
}

module.exports = { buildHeader, buildSummaryBar, buildSprintBar, buildFooter };
