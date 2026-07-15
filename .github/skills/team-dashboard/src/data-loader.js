// src/data-loader.js — Fetch JSON data files and populate appData.
// Exports:
//   loadData() → Promise<boolean>
//
// Imports:
//   { appData } from './state.js'
//   { extractSprints } from './data-utils.js'
//   { esc } from './suggestions-engine.js'

"use strict";
const { appData } = require('./state.js');
const { extractSprints } = require('./data-utils.js');
const { esc } = require('./suggestions-engine.js');

async function loadData() {
  try {
    const [resp, velResp] = await Promise.all([
      fetch('data/team-data.json?_=' + Date.now()),
      fetch('data/velocity-history.json?_=' + Date.now()).catch(() => null),
    ]);
    if (!resp.ok) throw new Error('Failed to load data: ' + resp.status);
    const json = await resp.json();

    appData.generatedAt   = json.meta.generatedAt;
    appData.sprintData    = json.sprint;
    appData.velocityPrev  = json.velocity.previous;
    appData.embedItems    = json.items;
    appData.activePRs     = json.activePRs || [];
    appData.roster        = json.roster;
    appData.carryOver     = json.carryOver || [];

    if (json.period) {
      appData.period.name  = json.period.name;
      appData.period.start = new Date(json.period.start);
      appData.period.end   = new Date(json.period.end);
    }

    // Derive sprint object with Date instances
    appData.sprint = {
      name:  json.sprint.name,
      start: new Date(json.sprint.start),
      end:   new Date(json.sprint.end),
      days:  json.sprint.days || 14,
    };

    if (velResp && velResp.ok) {
      try { appData.velocityHistory = await velResp.json(); }
      catch (_) { /* keep default */ }
    }

    return true;
  } catch (e) {
    console.error('Data load failed:', e);
    document.getElementById('app').innerHTML =
      '<div style="padding:40px;color:#f85149;font-size:1.2rem;">' +
      '⚠ Failed to load team-data.json<br>' +
      '<small style="color:#8b949e;">' + esc(e.message) +
      '<br>Run the collector: python collect.py --include-prs</small></div>';
    return false;
  }
}

module.exports = { loadData };
