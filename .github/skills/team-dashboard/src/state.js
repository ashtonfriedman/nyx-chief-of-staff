// src/state.js — Application state singletons.
// Import and mutate these objects directly. Because they are imported by reference,
// all modules that import them see the same object.
"use strict";

const appData = {
  generatedAt: null,
  sprintData: null,
  sprint: null,
  period: { name: '', start: null, end: null },
  velocityPrev: {},
  embedItems: [],
  activePRs: [],
  roster: {},
  carryOver: [],
  velocityHistory: { snapshots: [] },
};

const uiState = {
  activePerson: null,
  activeGroup: 'my-team',
  activeMode: 'team',     // 'team' or 'hygiene'
  activeView: 'sprint',   // team sub-view routing key
  selectedSprintIdx: -1,
  availableSprints: [],
  currentData: null,
  stalePrThresholdDays: 30,
  hygieneFilter: {
    category: 'all',  // 'all'|'orphaned'|'stale-prs'|'stuck'|'wrong-iteration'|'unestimated'|'empty-shells'
    user: null,       // string|null
    type: null,       // string|null
  },
  stuckDaysThreshold: 14,
};

function resetAppData() {
  appData.generatedAt = null;
  appData.sprintData = null;
  appData.sprint = null;
  appData.period = { name: '', start: null, end: null };
  appData.velocityPrev = {};
  appData.embedItems = [];
  appData.activePRs = [];
  appData.roster = {};
  appData.carryOver = [];
  appData.velocityHistory = { snapshots: [] };
}

module.exports = { appData, uiState, resetAppData };
