#!/usr/bin/env node
// snapshot-velocity.js — Captures per-sprint velocity into velocity-history.json
// Idempotent: updates existing sprint snapshots instead of duplicating them.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const TEAM_DATA_PATH = path.join(DATA_DIR, 'team-data.json');
const SPRINT_CONFIG_PATH = path.join(__dirname, 'sprint-config.json');
const HISTORY_PATH = path.join(DATA_DIR, 'velocity-history.json');

function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to load ${path.basename(filePath)}: ${err.message}`);
  }
}

function saveHistory(history) {
  const tmpPath = HISTORY_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(history, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, HISTORY_PATH);
}

function sprintSortKey(name) {
  // Extract numeric suffix for sorting (e.g. "Sprint-12" → 12)
  const match = name.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

function buildSnapshotFromItems(items, sprintCategory, sprintName, startDate, endDate) {
  const DONE_STATES = new Set(['Resolved', 'Closed']);
  const people = {};
  let teamPoints = 0;
  let teamItems = 0;

  for (const item of items) {
    if (item.sprintCategory !== sprintCategory) continue;
    if (!DONE_STATES.has(item.state)) continue; // Only count completed work for accurate velocity

    const person = item.assigned;
    if (!person) continue;

    if (!people[person]) people[person] = { points: 0, items: 0 };
    people[person].items += 1;
    people[person].points += (item.storyPoints || 0);
    teamItems += 1;
    teamPoints += (item.storyPoints || 0);
  }

  return {
    sprint: sprintName,
    startDate,
    endDate,
    capturedAt: new Date().toISOString(),
    team: { points: teamPoints, items: teamItems },
    people
  };
}

function buildSnapshotFromVelocityPrevious(velocityPrev, sprintName, startDate, endDate) {
  const people = {};
  let teamPoints = 0;
  let teamItems = 0;

  for (const [person, stats] of Object.entries(velocityPrev)) {
    people[person] = { points: stats.points || 0, items: stats.items || 0 };
    teamPoints += (stats.points || 0);
    teamItems += (stats.items || 0);
  }

  return {
    sprint: sprintName,
    startDate,
    endDate,
    capturedAt: new Date().toISOString(),
    team: { points: teamPoints, items: teamItems },
    people
  };
}

function upsertSnapshot(history, snapshot) {
  const idx = history.snapshots.findIndex(s => s.sprint === snapshot.sprint);
  if (idx >= 0) {
    history.snapshots[idx] = snapshot;
    console.log(`  Updated existing snapshot for ${snapshot.sprint}`);
  } else {
    history.snapshots.push(snapshot);
    console.log(`  Added new snapshot for ${snapshot.sprint}`);
  }
}

function run() {
  let data, sprintConfig;
  try {
    data = loadJSON(TEAM_DATA_PATH);
    sprintConfig = loadJSON(SPRINT_CONFIG_PATH);
  } catch (err) {
    console.error(`[snapshot-velocity] ${err.message}`);
    process.exit(1);
  }

  // Load or create history
  let history;
  if (fs.existsSync(HISTORY_PATH)) {
    history = loadJSON(HISTORY_PATH);
    console.log(`Loaded ${history.snapshots.length} existing snapshot(s)`);
  } else {
    history = { snapshots: [] };
    console.log('Created new velocity-history.json');
  }

  // --- Previous sprint snapshot (from velocity.previous) ---
  const prev = sprintConfig.previous;
  if (data.velocity && data.velocity.previous) {
    console.log(`\nSeeding previous sprint: ${prev.name}`);
    const prevSnapshot = buildSnapshotFromVelocityPrevious(
      data.velocity.previous, prev.name, prev.start, prev.end
    );
    upsertSnapshot(history, prevSnapshot);
  }

  // --- Current sprint snapshot (computed from items) ---
  const curr = sprintConfig.current;
  console.log(`\nComputing current sprint: ${curr.name}`);
  const currSnapshot = buildSnapshotFromItems(
    data.items, 'current', curr.name, curr.start, curr.end
  );
  upsertSnapshot(history, currSnapshot);

  // Sort by sprint number
  history.snapshots.sort((a, b) => sprintSortKey(a.sprint) - sprintSortKey(b.sprint));

  saveHistory(history);
  console.log(`\nSaved ${history.snapshots.length} snapshot(s) to velocity-history.json`);
}

if (require.main === module) run();

module.exports = { sprintSortKey, buildSnapshotFromItems, buildSnapshotFromVelocityPrevious, upsertSnapshot };
