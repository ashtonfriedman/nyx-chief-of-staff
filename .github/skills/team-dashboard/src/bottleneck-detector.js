// src/bottleneck-detector.js — bottleneck detection extracted from team-dashboard.js
// Pure function: all data comes in via the `person` parameter.
"use strict";

/**
 * Detect bottlenecks and refactoring suggestions for a person's work items.
 * Returns pre-computed bottlenecks if present, otherwise generates flags.
 * @param {Object} person - { items: [...], bottlenecks?: [...] }
 * @returns {Array<{severity:string, itemId?:number, msg:string}>}
 */
function detectBottlenecks(person) {
  const flags = [];
  for (const wi of person.items) {
    // Only flag with real data — if no age data exists, we can't judge
    const hasDateData = wi.age?.sinceStateChange != null || wi.age?.sinceAssigned != null;
    const ds = wi.age?.sinceStateChange;

    const prLinkable = wi.type === 'User Story' || wi.type === 'Bug' || wi.type === 'Task';
    if (hasDateData && prLinkable && wi.state === 'Active' && ds > 7 && (wi.prCount || 0) === 0)
      flags.push({ severity: 'high', itemId: wi.id, msg: `active ${Math.round(ds)}d, no linked PR` });
    if (hasDateData && wi.state === 'New' && ds > 3)
      flags.push({ severity: 'medium', itemId: wi.id, msg: `New for ${Math.round(ds)}d` });
  }
  if (person.items.filter(i => i.state === 'Active').length > 5)
    flags.push({ severity: 'medium', msg: `${person.items.length} items — possible overload` });

  // Refactoring suggestions (info-level)
  for (const wi of person.items) {
    const ds = wi.age?.sinceStateChange ?? wi.age?.sinceAssigned;
    const dsAny = wi.age?.sinceActivity ?? ds; // last activity of any kind
    if (ds == null) continue;
    if (wi.state === 'Active' && wi.type === 'Task' && ds > 5)
      flags.push({ severity: 'info', itemId: wi.id, msg: `Task active ${Math.round(ds)}d — consider promoting to User Story` });
    if (wi.state === 'Active' && wi.type === 'User Story' && ds > 28)
      flags.push({ severity: 'info', itemId: wi.id, msg: `Story active ${Math.round(ds)}d — consider promoting to Feature or decompose` });
    if (wi.state === 'Active' && wi.type === 'Feature' && ds > 84 && !(wi.childrenClosed > 0))
      flags.push({ severity: 'info', itemId: wi.id, msg: `Feature active ${Math.round(ds)}d, no children closed — may be too large or stalled` });
    if (wi.state === 'Active' && dsAny != null && dsAny > 42)
      flags.push({ severity: 'info', itemId: wi.id, msg: `no activity in ${Math.round(dsAny)}d — appears abandoned` });
  }

  return person.bottlenecks?.length ? person.bottlenecks : flags;
}

module.exports = { detectBottlenecks };
