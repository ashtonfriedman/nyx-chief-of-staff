// src/renderer/velocity.js — Velocity sparklines and team trend chart.
// Extracted from team-dashboard.js (monolith lines 963–1023).
// Pure functions — history passed as parameter, no global reads.
"use strict";

const { esc } = require('../suggestions-engine.js');

/**
 * Render an SVG sparkline for a person's velocity across sprint snapshots.
 * @param {string} personName
 * @param {Object} history - { snapshots: [{ people: { [name]: { points } }, sprint }] }
 * @returns {string} SVG markup or empty string
 */
function renderSparkline(personName, history) {
  const snaps = (history && history.snapshots) || [];
  const values = [];
  for (const s of snaps) {
    const p = s.people && s.people[personName];
    if (p != null) values.push(p.points || 0);
  }
  if (values.length < 2) return '';

  const W = 40, H = 16;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 2) - 1;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const last = values[values.length - 1];
  const color = last >= avg ? 'var(--green, #4caf50)' : 'var(--yellow, #ff9800)';
  const lastPt = pts[pts.length - 1].split(',');

  return '<svg class="wp-sparkline" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="1.5" fill="' + color + '"/>' +
    '</svg>';
}

/**
 * Render an SVG team-wide velocity trend chart.
 * @param {Object} history - { snapshots: [{ team: { points }, sprint }] }
 * @returns {string} HTML markup or empty string
 */
function renderTeamTrend(history) {
  const snaps = (history && history.snapshots) || [];
  if (snaps.length < 2) return '';

  const values = snaps.map(s => (s.team && s.team.points) || 0);
  const labels = snaps.map(s => s.sprint || '');
  const W = 120, H = 24;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return x.toFixed(1) + ',' + y.toFixed(1);
  });

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const last = values[values.length - 1];
  const color = last >= avg ? 'var(--green, #4caf50)' : 'var(--yellow, #ff9800)';
  const lastPt = pts[pts.length - 1].split(',');
  const titleText = labels.map((l, i) => l + ': ' + values[i] + 'pts').join(' → ');

  return '<span class="wp-team-trend" title="' + esc(titleText) + '">' +
    '<span class="wp-team-trend-label">Team Velocity Trend</span>' +
    '<svg class="wp-team-trend-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="' + lastPt[0] + '" cy="' + lastPt[1] + '" r="2" fill="' + color + '"/>' +
    '</svg></span>';
}

module.exports = {
  renderSparkline,
  renderTeamTrend,
};
