// src/data-utils.js — pure domain logic extracted from team-dashboard.js
"use strict";

const { AI_TAG_PATTERN } = require('./constants.js');

/** Test whether a tags string contains an AI-related tag. */
function hasAiTag(tags) {
  return AI_TAG_PATTERN.test(tags || '');
}

/**
 * Group flat work-items by assigned person, optionally filtering to a sprint.
 * If `raw` already has a `people` array, returns it as-is.
 *
 * @param {Array|Object} raw         - flat items array or pre-grouped object
 * @param {string|null}  sprintFilter - iteration substring to match (e.g. "Sprint-5")
 * @param {string}       generatedAt  - ISO timestamp (replaces global GENERATED_AT)
 * @param {string}       sprintName   - current sprint display name (replaces global SPRINT.name)
 */
function normalizeData(raw, sprintFilter, generatedAt, sprintName) {
  if (raw.people) return raw;
  let items = raw;
  if (sprintFilter) {
    items = items.filter(i => i.iteration && i.iteration.includes(sprintFilter));
  }
  const byP = {};
  for (const item of items) {
    const n = item.assigned || 'Unassigned';
    if (!byP[n]) byP[n] = { name: n, items: [], bottlenecks: [] };
    byP[n].items.push(item);
  }
  return {
    people: Object.values(byP),
    generatedAt: generatedAt || new Date().toISOString(),
    sprint: sprintName || '',
  };
}

/**
 * Parse unique Sprint entries from a flat items array.
 * Returns sorted array of { name, num, iterationPath, dateRange }.
 */
function extractSprints(items) {
  const sprintMap = {};
  for (const item of items) {
    if (!item.iteration) continue;
    const match = item.iteration.match(/Sprint-(\d+)\s*\(([^)]+)\)/);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    const key = `Sprint-${num}`;
    if (!sprintMap[key]) {
      const dateRange = match[2];
      sprintMap[key] = { name: key, num, iterationPath: item.iteration, dateRange };
    }
  }
  return Object.values(sprintMap).sort((a, b) => a.num - b.num);
}

/**
 * Build a parent/child hierarchy from a flat items array.
 * Returns { sprint: [...], features: [...] } where each entry is { item, children }.
 */
function buildHierarchy(items) {
  const byId = {};
  for (const i of items) byId[i.id] = i;

  const parentIds = new Set();
  const childOf = {};
  const childrenByParent = {};
  for (const i of items) {
    if (i.parent && byId[i.parent]) {
      childOf[i.id] = i.parent;
      parentIds.add(i.parent);
      (childrenByParent[i.parent] ??= []).push(i);
    }
  }

  const features = [], sprintParents = [], sprintOrphans = [];

  for (const i of items) {
    if (childOf[i.id]) continue;
    const children = childrenByParent[i.id] || [];
    if (i.type === 'Feature') {
      features.push({ item: i, children });
    } else {
      if (children.length > 0 || parentIds.has(i.id)) {
        sprintParents.push({ item: i, children });
      } else {
        sprintOrphans.push({ item: i, children: [] });
      }
    }
  }

  const sortFn = (a, b) => {
    const so = { New: 0, Active: 1, 'In Progress': 2, Resolved: 3, Closed: 4 };
    const sd = (so[a.item.state] ?? 9) - (so[b.item.state] ?? 9);
    return sd !== 0 ? sd : (a.item.priority || 9) - (b.item.priority || 9);
  };
  sprintParents.sort(sortFn);
  sprintOrphans.sort(sortFn);
  features.sort(sortFn);

  return { sprint: [...sprintParents, ...sprintOrphans], features };
}

module.exports = { hasAiTag, normalizeData, extractSprints, buildHierarchy };
