"use strict";
const { SPRINT_TYPES, DONE_STATES, EXECUTION_STATES } = require('./constants.js');

/**
 * Items assigned to someone not in the roster.
 */
function getOrphanedItems(items, roster) {
  return items
    .filter(i => i.assigned && !roster[i.assigned] && !DONE_STATES.has(i.state))
    .sort((a, b) => a.assigned.localeCompare(b.assigned) || a.type.localeCompare(b.type));
}

/**
 * Items that haven't changed state in too long.
 * Sprint items use the caller-supplied threshold; Features/Epics use 30 days.
 */
function getStuckItems(items, stuckDaysThreshold) {
  return items
    .filter(i => {
      if (DONE_STATES.has(i.state)) return false;
      const days = (i.age && i.age.sinceStateChange) || 0;
      if (SPRINT_TYPES.has(i.type)) {
        // "New" means work hasn't started — not stuck yet
        if (i.state === 'New') return false;
        if (!EXECUTION_STATES.has(i.state)) return false;
        return days >= stuckDaysThreshold;
      }
      if (i.type === 'Feature' || i.type === 'Epic') {
        return i.state === 'Active' && days >= 30;
      }
      return false;
    })
    .sort((a, b) => (b.age.sinceStateChange || 0) - (a.age.sinceStateChange || 0));
}

/**
 * Sprint items lingering in a past iteration while still in an execution state.
 */
function getWrongIterationItems(items) {
  const catOrder = { previous: 0, past: 1 };
  const stateOrder = { Active: 0 };
  return items
    .filter(i =>
      (i.sprintCategory === 'past' || i.sprintCategory === 'previous') &&
      EXECUTION_STATES.has(i.state) &&
      SPRINT_TYPES.has(i.type)
    )
    .sort((a, b) => {
      const ca = catOrder[a.sprintCategory] ?? 2;
      const cb = catOrder[b.sprintCategory] ?? 2;
      if (ca !== cb) return ca - cb;
      const sa = stateOrder[a.state] ?? 1;
      const sb = stateOrder[b.state] ?? 1;
      return sa - sb;
    });
}

/**
 * Sprint items in current/previous sprints that lack story-point estimates.
 */
function getUnestimatedItems(items) {
  return items
    .filter(i =>
      SPRINT_TYPES.has(i.type) &&
      !i.storyPoints &&
      !DONE_STATES.has(i.state) &&
      (i.sprintCategory === 'current' || i.sprintCategory === 'previous')
    )
    .sort((a, b) => a.type.localeCompare(b.type) || a.state.localeCompare(b.state));
}

/**
 * Features/Epics with no children — empty planning shells.
 */
function getEmptyShells(items) {
  const typeOrder = { Epic: 0, Feature: 1 };
  const stateOrder = { Active: 0 };
  return items
    .filter(i =>
      (i.type === 'Feature' || i.type === 'Epic') &&
      (!i.childIds || i.childIds.length === 0) &&
      !DONE_STATES.has(i.state)
    )
    .sort((a, b) => {
      const ta = typeOrder[a.type] ?? 2;
      const tb = typeOrder[b.type] ?? 2;
      if (ta !== tb) return ta - tb;
      const sa = stateOrder[a.state] ?? 1;
      const sb = stateOrder[b.state] ?? 1;
      return sa - sb;
    });
}

/**
 * Generic user/type filter applied to any hygiene result set.
 */
function applyHygieneFilters(items, filter) {
  let result = items;
  if (filter.user) result = result.filter(i => i.assigned === filter.user);
  if (filter.type) result = result.filter(i => i.type === filter.type);
  return result;
}

module.exports = {
  getOrphanedItems,
  getStuckItems,
  getWrongIterationItems,
  getUnestimatedItems,
  getEmptyShells,
  applyHygieneFilters,
};
