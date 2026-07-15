#!/usr/bin/env node

// Boot context gatherer for the agent.
// Reads exactly the boot files and runs the boot checks.
// Output is structured text for the agent to orient from.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const AGENT_PATH = resolve(SCRIPT_DIR, '..', '..');
const MIND_PATH = process.env.MIND_PATH || AGENT_PATH;

// Timezone for the boot clock. Override with the IANA name for your timezone,
// or set the MIND_TZ env var (e.g. "America/New_York", "Europe/London").
const TIMEZONE = process.env.MIND_TZ || 'America/New_York';

function readSafe(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function parseJsonSafe(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function execSafe(cmd, cwd) {
  try { return execSync(cmd, { cwd, encoding: 'utf-8', timeout: 10000 }).trim(); } catch { return null; }
}

// --- 1. Boot files ---
const soul = readSafe(join(AGENT_PATH, 'SOUL.md'));
const bootContext = readSafe(join(MIND_PATH, '.working-memory', 'graph-boot-context.md'));
const log = readSafe(join(MIND_PATH, '.working-memory', 'log.md'));

// --- 2. Time (pure-Node via Intl; IANA tz handles DST automatically) ---
let currentTime = null;
let hour = null;
try {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long', hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const hh = p.hour === '24' ? '00' : p.hour;
  currentTime = `${p.year}-${p.month}-${p.day} ${hh}:${p.minute} ${p.weekday}`;
  hour = parseInt(hh, 10);
} catch { /* Intl/ICU unavailable — leave time null */ }

// --- 3. Git status ---
const gitStatus = execSafe('git status --short', MIND_PATH) || '';

// --- 4. Log line count ---
const logLines = log ? log.split('\n').length : 0;

// --- 5. Maintenance daemon status (morning only) ---
let daemonReport = null;
if (hour !== null && hour < 10) {
  const daemonText = readSafe(join(AGENT_PATH, '.github', 'scripts', 'data', 'agent-maintenance-state.json'));
  const d = daemonText ? parseJsonSafe(daemonText) : null;
  if (d) {
    const lastSuccess = d.last_success ? new Date(d.last_success) : null;
    const today = new Date().toISOString().slice(0, 10);
    const successToday = lastSuccess && lastSuccess.toISOString().slice(0, 10) === today;
    if (successToday) {
      daemonReport = `✅ Maintenance succeeded today at ${lastSuccess.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} (run ${d.run_count})`;
    } else if (d.consecutive_failures > 0) {
      daemonReport = `⚠️ Maintenance failed. ${d.consecutive_failures} consecutive failures. Error: ${d.error || 'unknown'}`;
    }
  } else if (daemonText) {
    daemonReport = '⚠️ Daemon state file is malformed';
  }
}

// --- 6. Boot actions ---
const actions = [];
if (gitStatus) actions.push('Dirty working tree — surface to the user before new work');
if (logLines > 80) actions.push('Log over 80 lines — run the log-consolidate skill, then commit');

// --- Output ---
console.log('═══ BOOT CONTEXT ═══\n');
console.log(`⏰ ${currentTime || 'TIME UNAVAILABLE'}\n`);

if (actions.length > 0) {
  console.log('═══ BOOT ACTIONS ═══');
  actions.forEach(a => console.log(`  → ${a}`));
  console.log('');
}

if (gitStatus) {
  console.log(`⚠️ DIRTY FILES:\n${gitStatus}\n`);
} else {
  console.log('✅ Clean working tree\n');
}

console.log(`📋 Log: ${logLines} lines${logLines > 80 ? ' ⚠️ CONSOLIDATION NEEDED' : ''}\n`);
if (daemonReport) console.log(`🔧 ${daemonReport}\n`);

console.log('═══ SOUL ═══\n');
console.log(soul || '⚠️ SOUL.md not found');

console.log('\n═══ GRAPH BOOT CONTEXT ═══\n');
console.log(bootContext || '⚠️ graph-boot-context.md not found — fall back to memory.md + rules.md, then run graph-index');

// Log: show carry-forwards + last 3 sessions if over threshold
console.log('\n═══ LOG ═══\n');
if (log) {
  if (logLines > 80) {
    const lines = log.split('\n');
    const sessionStarts = [];
    lines.forEach((l, i) => { if (l.startsWith('### 20')) sessionStarts.push(i); });
    const cutoff = sessionStarts.length > 3 ? sessionStarts[sessionStarts.length - 3] : 0;
    const carrySection = lines.slice(0, sessionStarts[0] || lines.length).join('\n');
    const recentSessions = lines.slice(cutoff).join('\n');
    console.log(carrySection);
    console.log(`\n... (${logLines} total lines — showing carry-forwards + last 3 sessions) ...\n`);
    console.log(recentSessions);
  } else {
    console.log(log);
  }
} else {
  console.log('⚠️ log.md not found');
}

console.log('\n═══ END BOOT ═══');
console.log('memory.md and rules.md are demand-loaded. Do not read them until a topic requires them.');
