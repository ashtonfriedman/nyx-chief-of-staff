// src/constants.js — shared constants for team dashboard
// Isomorphic: works in browser (ES module) and Node (CommonJS)
"use strict";

const ADO_BASE = 'https://dev.azure.com/{your-org}/{your-project}/_workitems/edit/';
const ADO_PR_BASE = 'https://dev.azure.com/{your-org}/{your-project}/_git/{your-repo}/pullrequest/';

// Health thresholds in BUSINESS DAYS (not calendar days)
// User Stories/Bugs: storyPoints = dev days. Thresholds scale with effort.
// Features: storyPoints = sprints (10 bdays each)
// Epics: scored by child progress, not age
const TH = {
  'User Story': { w: 6, a: 10, c: 20 },
  'Bug':        { w: 4, a: 8,  c: 15 },
  'Task':       { w: 5, a: 10, c: 20 },
  'Feature':    { w: 30, a: 50, c: 90 },
  'Epic':       { w: Infinity, a: Infinity, c: Infinity },
};

const TH_BACKLOG = {
  'User Story': { w: 10, a: 20, c: 40 },
  'Bug':        { w: 8,  a: 15, c: 30 },
  'Task':       { w: 10, a: 20, c: 40 },
  'Feature':    { w: 60, a: 100, c: 180 },
  'Epic':       { w: Infinity, a: Infinity, c: Infinity },
};

// Sprint-scoped types — Features and Epics are period-scoped, never in sprints
const SPRINT_TYPES = new Set(['User Story', 'Bug', 'Task']);

// Types that can have PRs linked
const PR_TYPES = new Set(['User Story', 'Bug', 'Task']);

// Microsoft 2026 holidays (month is 0-indexed)
const MS_HOLIDAYS_2026 = [
  new Date(2026, 0, 1),   // New Year's Day
  new Date(2026, 0, 19),  // MLK Day
  new Date(2026, 1, 16),  // Presidents' Day
  new Date(2026, 4, 25),  // Memorial Day
  new Date(2026, 6, 3),   // Independence Day (observed)
  new Date(2026, 8, 7),   // Labor Day
  new Date(2026, 10, 26), // Thanksgiving
  new Date(2026, 10, 27), // Day after Thanksgiving
  new Date(2026, 11, 24), // Christmas Eve
  new Date(2026, 11, 25), // Christmas Day
  new Date(2026, 11, 31), // New Year's Eve
];
const MS_HOLIDAY_SET = new Set(MS_HOLIDAYS_2026.map(d => d.toDateString()));

// AI tag detection pattern (non-global for safe .test() use)
const AI_TAG_PATTERN = /\b(cline|copilot|ai|github\.copilot|cursor|windsurf)\b/i;

const SPRINT_CATEGORY = Object.freeze({
  CURRENT: 'current',
  PREVIOUS: 'previous',
  PAST: 'past',
  FUTURE: 'future',
  PERIOD: 'period',
  BACKLOG: 'backlog',
});

const DONE_STATES = new Set(['Resolved', 'Closed']);
const EXECUTION_STATES = new Set(['New', 'Active', 'In Progress']);

/** Sanitize a URL for use in href attributes. Blocks javascript: and data: URIs. */
function safeHref(url) {
  if (!url || typeof url !== 'string') return '#';
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:') || trimmed.startsWith('vbscript:')) return '#';
  return url;
}

// Dual export: ES module for browser, CommonJS for Node tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ADO_BASE, ADO_PR_BASE, TH, TH_BACKLOG, SPRINT_TYPES, PR_TYPES,
    MS_HOLIDAYS_2026, MS_HOLIDAY_SET, AI_TAG_PATTERN, safeHref,
    SPRINT_CATEGORY, DONE_STATES, EXECUTION_STATES,
  };
}
