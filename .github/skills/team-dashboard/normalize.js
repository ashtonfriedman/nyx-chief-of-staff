#!/usr/bin/env node
// normalize.js — transforms collect.py output into team-dashboard.html format
"use strict";

const fs = require("fs");
const path = require("path");

// --- Config from sprint-config.json ------------------------------------------

const configPath = path.join(__dirname, "sprint-config.json");
if (!fs.existsSync(configPath)) {
  console.error(`Error: ${configPath} not found. Create sprint-config.json first.`);
  process.exit(1);
}
const CONFIG = JSON.parse(fs.readFileSync(configPath, "utf8"));

const SPRINT = {
  name: CONFIG.current.name,
  start: CONFIG.current.start,
  end: CONFIG.current.end,
  days: CONFIG.current.days || 14,
};
const PERIOD = {
  name: CONFIG.period.name,
  start: CONFIG.period.start,
  end: CONFIG.period.end,
};
const ROSTER = (() => {
  const staticRoster = CONFIG.roster || {};
  const computedPath = path.join(__dirname, "data", "computed-roster.json");
  if (fs.existsSync(computedPath)) {
    try {
      const dynamic = JSON.parse(fs.readFileSync(computedPath, "utf8"));
      return { ...staticRoster, ...dynamic };
    } catch (_) { /* fall through to static */ }
  }
  return staticRoster;
})();

const AI_TAG_PATTERN = /\b(cline|copilot|ai|github\.copilot|cursor|windsurf)\b/gi;

const ADO_PR_BASE= "https://dev.azure.com/{your-org}/{your-project}/_apis/git/repositories";

// --- Sprint classification ---------------------------------------------------

function classifyIteration(iterationPath, config) {
  if (!iterationPath) return 'backlog';

  // Exact match for current sprint
  if (iterationPath === config.current.iterationPath) return 'current';

  // Exact match for previous sprint
  if (config.previous && iterationPath === config.previous.iterationPath) return 'previous';

  // Check if it's a Sprint path (contains "Sprint-" + number)
  const sprintMatch = iterationPath.match(/Sprint-(\d+)/);
  if (sprintMatch) {
    const sprintNum = parseInt(sprintMatch[1], 10);
    const currentMatch = config.current.name.match(/Sprint-(\d+)/);
    const currentNum = currentMatch ? parseInt(currentMatch[1], 10) : 0;
    if (sprintNum < currentNum) return 'past';
    if (sprintNum > currentNum) return 'future';
    return 'current'; // same number = current
  }

  // Period level (contains the configured period name but no Sprint-)
  if (config.period && iterationPath.includes(config.period.name)) return 'period';

  // Everything else (top level "{your-project}" or empty)
  return 'backlog';
}

// --- Helpers -----------------------------------------------------------------

function extractPrId(url) {
  // URLs look like vstfs:///Git/PullRequestId/{org}%2F{repo}%2F{prId}
  // or could be a normal URL ending in /pullRequests/{prId}
  const decoded = decodeURIComponent(url);
  const match = decoded.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA);
  const b = new Date(isoB);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round(((b - a) / 86400000) * 10) / 10;
}

function transformLinkedPRs(linkedPRs) {
  if (!Array.isArray(linkedPRs)) return [];
  return linkedPRs.map((pr) => ({
    name: pr.name || "Pull Request",
    url: pr.url || "",
    id: extractPrId(pr.url || ""),
  }));
}

// Strip parenthetical suffixes from display names: "Name (she/her)" → "Name"
function normalizeName(name) {
  if (!name) return name;
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function transformWorkItem(wi) {
  const age = { ...(wi.age || {}) };

  // Compute cycleTime: days between activated and (closed || resolved)
  const dates = wi.dates || {};
  const endDate = dates.closed || dates.resolved;
  if (dates.activated && endDate) {
    const ct = daysBetween(dates.activated, endDate);
    if (ct !== null) age.cycleTime = ct;
  }

  return {
    id: wi.id,
    type: wi.type,
    state: wi.state,
    priority: wi.priority,
    title: wi.title,
    tags: wi.tags,
    assigned: normalizeName(wi.assigned),
    parent: wi.parent,
    iteration: wi.iteration,
    sprintCategory: classifyIteration(wi.iteration, CONFIG),
    storyPoints: wi.storyPoints,
    commentCount: wi.commentCount || 0,
    prCount: wi.prCount,
    age,
    linkedPRs: transformLinkedPRs(wi.linkedPRs),
    childIds: wi.childIds || [],
    aiTags: (wi.tags || '').match(AI_TAG_PATTERN) || [],
  };
}

function transformPullRequest(pr) {
  const repo = pr.repository || "";
  const prId = pr.id;
  return {
    prId,
    repo,
    url: `${ADO_PR_BASE}/${encodeURIComponent(repo)}/pullRequests/${prId}`,
    title: pr.title,
    status: pr.status,
    createdBy: normalizeName(pr.createdBy),
    createdDate: pr.createdDate,
    sourceBranch: pr.sourceBranch,
    targetBranch: pr.targetBranch,
    age: pr.age,
    isDraft: pr.isDraft,
  };
}

// --- Main --------------------------------------------------------------------

function main() {
  const dataDir = path.join(__dirname, "data");
  const filePath = path.join(dataDir, "team-data.json");

  if (!fs.existsSync(filePath)) {
    console.error(`Error: ${filePath} not found. Run collect.py first.`);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const people = raw.people || {};

  // Flatten work items and PRs across all people
  const items = [];
  const activePRs = [];

  for (const person of Object.values(people)) {
    for (const wi of person.workItems || []) {
      items.push(transformWorkItem(wi));
    }
    for (const pr of person.pullRequests || []) {
      activePRs.push(transformPullRequest(pr));
    }
  }

  // Deduplicate PRs by prId (same PR may appear under multiple people)
  const seenPRs = new Set();
  const uniquePRs = activePRs.filter((pr) => {
    if (seenPRs.has(pr.prId)) return false;
    seenPRs.add(pr.prId);
    return true;
  });

  // Merge previous sprint closed items into the items array so they appear
  // when navigating to historical sprints. Also build velocity aggregates.
  const velocity = { previous: {} };
  const existingIds = new Set(items.map(i => i.id));
  if (raw.previousSprint && raw.previousSprint.people) {
    let mergedCount = 0;
    for (const [name, pdata] of Object.entries(raw.previousSprint.people)) {
      const closedItems = (pdata.workItems || []);
      const points = closedItems.reduce((sum, wi) => sum + (wi.storyPoints || 0), 0);
      velocity.previous[name] = { points, items: closedItems.length };

      // Add closed items to main array (dedup by ID)
      for (const wi of closedItems) {
        if (!existingIds.has(wi.id)) {
          items.push(transformWorkItem(wi));
          existingIds.add(wi.id);
          mergedCount++;
        }
      }
    }
    if (mergedCount > 0) {
      console.log(`  Merged ${mergedCount} previous sprint closed items into items array`);
    }
  }

  // Detect carry-over items: previous sprint items still active
  const carryOver = CONFIG.previous
    ? items.filter(wi => wi.sprintCategory === 'previous').map(wi => wi.id)
    : [];

  const output = {
    meta: {
      generatedAt: (raw.meta && raw.meta.generatedAt) || new Date().toISOString(),
      collectorVersion: "collect-v2.5",
    },
    sprint: SPRINT,
    period: PERIOD,
    velocity,
    carryOver,
    items,
    activePRs: uniquePRs,
    roster: ROSTER,
  };

  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(output, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
  console.log(
    `Normalized: ${items.length} items, ${uniquePRs.length} PRs, ${Object.keys(velocity.previous).length} velocity entries, ${carryOver.length} carry-overs, ${Object.keys(ROSTER).length} roster entries → ${filePath}`
  );
}

// Run main only when executed directly (not when required for testing)
if (require.main === module) main();

// Export internals for testing
module.exports = { classifyIteration, extractPrId, daysBetween, normalizeName, transformLinkedPRs };
