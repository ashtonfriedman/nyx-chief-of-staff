// src/suggestions-engine.js — Pure domain logic for notification suggestions.
// Extracted from team-dashboard.js for testability and reuse.
// No DOM, no globals — all dependencies injected via parameters and ctx.
"use strict";

const { ADO_BASE, ADO_PR_BASE } = require('./constants.js');
const { scoreHealth, daysBetween } = require('./health-scorer.js');

/**
 * HTML-escape a string without DOM (Node-safe replacement for browser `esc`).
 */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate prioritised action suggestions for the dashboard.
 *
 * @param {Array} people  — array of { name, items[] } person objects
 * @param {Array} prs     — array of active PR objects (may be empty)
 * @param {Object} ctx    — runtime context carrying globals:
 *   ctx.SPRINT               — { start: Date, end: Date, days: number, name: string }
 *   ctx.STALE_PR_THRESHOLD_DAYS — number (default 30)
 * @returns {Array} up to 5 suggestion objects sorted by priority
 */
function generateSuggestions(people, prs, ctx) {
  const SPRINT = ctx.SPRINT;
  const STALE_PR_THRESHOLD_DAYS = ctx.STALE_PR_THRESHOLD_DAYS ?? 30;

  const suggestions = [];
  const now = new Date();
  const sprintDay = daysBetween(SPRINT.start, now);
  const sprintPct = Math.min(100, Math.round(sprintDay / SPRINT.days * 100));
  const sprintDaysLeft = Math.max(0, daysBetween(now, SPRINT.end));

  for (const p of people) {
    if (p.name === 'Unassigned') continue;
    const firstName = p.name.split(' ')[0];
    const activeItems = p.items.filter(i => i.state === 'Active');

    // 1. Critical health items (priority 1)
    for (const item of p.items) {
      if (scoreHealth(item) === 'critical') {
        const days = item.age?.sinceAssigned ?? item.age?.sinceActivated ?? item.age?.sinceStateChange;
        const dRound = days != null ? Math.round(days) : '?';
        suggestions.push({
          icon: '🔴', person: p.name, priority: 1,
          text: `Check <a href="${ADO_BASE}${item.id}" target="_blank">#${item.id}</a> with <span class="sug-person" data-action="select-person" data-person="${esc(p.name)}">${esc(firstName)}</span> — ${esc(item.type)} active ${dRound}d, critical cycle time`
        });
      }
    }

    // 2. Sprint closure risk (priority 2) — active, no PR, sprint >80%
    if (sprintPct >= 80) {
      for (const item of activeItems) {
        if ((item.prCount || 0) === 0 && (item.type === 'User Story' || item.type === 'Bug' || item.type === 'Task')) {
          const closeTxt = sprintDaysLeft <= 1 ? 'sprint closes tomorrow' : `${sprintDaysLeft}d left in sprint`;
          suggestions.push({
            icon: '⚠️', person: p.name, priority: 2,
            text: `<a href="${ADO_BASE}${item.id}" target="_blank">#${item.id}</a> assigned to <span class="sug-person" data-action="select-person" data-person="${esc(p.name)}">${esc(firstName)}</span> — active, no PR, ${closeTxt}`
          });
        }
      }
    }

    // 3. Overloaded people (priority 3) — >5 active items
    if (activeItems.length > 5) {
      suggestions.push({
        icon: '📋', person: p.name, priority: 3,
        text: `<span class="sug-person" data-action="select-person" data-person="${esc(p.name)}">${esc(firstName)}</span> has ${activeItems.length} active items — review priorities`
      });
    }

    // 5. Unstarted work (priority 5) — New with <2 days left
    if (sprintDaysLeft < 2) {
      for (const item of p.items.filter(i => i.state === 'New')) {
        suggestions.push({
          icon: '⏰', person: p.name, priority: 5,
          text: `<a href="${ADO_BASE}${item.id}" target="_blank">#${item.id}</a> still in New — will it make this sprint?`
        });
      }
    }
  }

  // 4. Stale PRs (priority 4) — >STALE_PR_THRESHOLD_DAYS old
  if (prs) {
    for (const pr of prs) {
      const ageDays = pr.createdDate ? daysBetween(new Date(pr.createdDate), now) : 0;
      if (ageDays >= STALE_PR_THRESHOLD_DAYS) {
        const firstName = pr.createdBy.split(' ')[0];
        const truncTitle = pr.title.length > 40 ? pr.title.slice(0, 37) + '…' : pr.title;
        const prUrl = ADO_PR_BASE + pr.prId;
        suggestions.push({
          icon: '🔀', person: pr.createdBy, priority: 4,
          text: `<span class="sug-person" data-action="select-person" data-person="${esc(pr.createdBy)}">${esc(firstName)}</span>'s PR '<a href="${prUrl}" target="_blank">${esc(truncTitle)}</a>' is ${ageDays}d old — close or merge?`
        });
      }
    }
  }

  suggestions.sort((a, b) => a.priority - b.priority);
  return suggestions.slice(0, 5);
}

module.exports = { generateSuggestions, esc };
