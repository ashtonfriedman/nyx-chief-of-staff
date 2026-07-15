// src/health-scorer.js — Pure domain logic for work-item health scoring.
// Extracted from team-dashboard.js for testability and reuse.
// No DOM, no globals — all dependencies injected via constants.
"use strict";

const { TH, TH_BACKLOG } = require('./constants.js');

/**
 * Calendar-day difference between two Date-compatible values.
 */
function daysBetween(d1, d2) { return Math.round((d2 - d1) / 864e5); }

/**
 * Convert calendar days to approximate business days.
 * Subtracts weekends (~2/7) and ~1 holiday per 30 calendar days.
 */
function businessDays(calendarDays) {
  // Convert calendar days to approximate business days
  // Rough: subtract weekends (2/7 of days) then subtract ~1 holiday per 30 bdays
  if (calendarDays == null || calendarDays <= 0) return 0;
  const weeks = Math.floor(calendarDays / 7);
  const remainder = calendarDays % 7;
  let bdays = weeks * 5 + Math.min(remainder, 5);
  // Subtract approximate holidays (1 per 30 calendar days on average)
  bdays = Math.max(0, bdays - Math.floor(calendarDays / 30));
  return Math.round(bdays);
}

/**
 * Return the threshold-lookup key for an item.
 * Low-priority bugs get their own bucket; unknown types fall back to 'User Story'.
 */
function thKey(item) {
  if (item.type === 'Bug' && item.priority > 2) return 'Bug-low';
  return TH[item.type] ? item.type : 'User Story';
}

/**
 * Score work-item health: 'ok' | 'warning' | 'alert' | 'critical'.
 * Uses effort-aware thresholds that scale with storyPoints.
 */
function scoreHealth(item) {
  const type = item.type || 'Task';
  const days = item.age?.sinceStateChange;
  if (days == null) return 'ok';

  const bdays = businessDays(days);

  // Epics: never flag on age
  if (type === 'Epic') return 'ok';

  // Get base thresholds
  const isBacklog = item.state === 'New' || item.state === 'Ready to Code';
  const baseT = (isBacklog ? TH_BACKLOG : TH)[type] || TH['Task'];

  // Effort-aware scaling for Stories and Bugs
  let t = baseT;
  const pts = item.storyPoints;
  if ((type === 'User Story' || type === 'Bug') && pts && pts > 0) {
    t = { w: pts * 2, a: pts * 3, c: pts * 5 };
    // Minimum thresholds so 1-point items don't instantly flag
    t.w = Math.max(t.w, 3);
    t.a = Math.max(t.a, 5);
    t.c = Math.max(t.c, 8);
  } else if (type === 'Feature' && pts && pts > 0) {
    // Feature points = sprints, 1 sprint = 10 business days
    t = { w: pts * 10 * 1.5, a: pts * 10 * 2.5, c: pts * 10 * 5 };
  }

  if (bdays >= t.c) return 'critical';
  if (bdays >= t.a) return 'alert';
  if (bdays >= t.w) return 'warning';
  return 'ok';
}

module.exports = { daysBetween, businessDays, thKey, scoreHealth };
