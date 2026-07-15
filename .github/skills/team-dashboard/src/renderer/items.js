// src/renderer/items.js — Work-item rendering: rows, detail panels, groups, lists.
// Extracted from team-dashboard.js lines 339–449.
"use strict";

const { scoreHealth, daysBetween } = require('../health-scorer.js');
const { ADO_BASE, ADO_PR_BASE, safeHref } = require('../constants.js');
const { esc } = require('../suggestions-engine.js');

/**
 * CSS class name for a work-item type badge.
 * @param {string} type - Work-item type (Bug, Task, User Story, Feature)
 * @returns {string}
 */
function typeClass(type) {
  return { Bug: 'bug', Task: 'task', 'User Story': 'story', Feature: 'feature' }[type] || '';
}

/**
 * Render a single work-item row.
 * @param {object} item - Work-item object
 * @param {object} options
 * @param {object|null} options.sprint - Sprint object with { start, end, days, name }
 * @param {Array}       options.activePRs - Active PRs array (replaces ACTIVE_PRS global)
 * @param {boolean}     options.isChild - Whether this row is a child row
 * @param {boolean}     options.hasChildren - Whether this item has children
 * @returns {string} HTML string
 */
function renderRow(item, { sprint = null, activePRs = [], isChild = false, hasChildren = false } = {}) {
  const h = scoreHealth(item);
  const pr = item.prCount || item.linkedPRs?.length || 0;

  // Assigned age: how long assigned to this person
  const assignedAge = item.age?.sinceAssigned;
  let assignedStr = '\u2014';
  if (assignedAge != null) assignedStr = Math.round(assignedAge) + 'd';

  // State age: how long in current state
  const stateAge = item.age?.sinceStateChange;
  let stateStr = '\u2014';
  if (stateAge != null) stateStr = Math.round(stateAge) + 'd';
  else if (item.state === 'Active' && sprint) stateStr = '~' + daysBetween(sprint.start, new Date()) + 'd';

  const cls = isChild ? 'wi-row child-row' : `wi-row parent-row${hasChildren ? ' has-children' : ''}`;
  const chevron = (!isChild && hasChildren)
    ? '<span class="chevron">\u25BC</span>'
    : (!isChild ? '<span style="display:inline-block;width:16px"></span>' : '');

  // Detail toggle icon (only for non-child rows with PR or link data)
  const hasPersonPRs = !isChild && Array.isArray(activePRs) && activePRs.some(p => p.createdBy === item.assigned);
  const hasDetail = !isChild && (pr > 0 || (item.childIds?.length || 0) > 0 || (item.linkedPRs?.length || 0) > 0 || hasPersonPRs);
  const detailIcon = hasDetail
    ? '<span class="detail-toggle" data-action="toggle-detail" title="Show links &amp; PRs">\u22EF</span>'
    : '<span style="width:20px;display:inline-block"></span>';

  return `<div class="${cls}">
    <span class="wi-id">${isChild ? '<span class="nest-line">\u2514</span>' : ''}
      <a href="${ADO_BASE}${item.id}" target="_blank">${item.id}</a></span>
    <span><span class="wi-type ${typeClass(item.type)}">${item.type}</span></span>
    <span class="wi-title" title="${esc(item.title)}">${chevron}${esc(item.title)}</span>
    <span><span class="state-dot ${item.state.toLowerCase().replace(/\s/g, '')}"></span>${item.state}</span>
    <span><span class="health-dot ${h}" title="${h === 'ok' ? 'Healthy \u2014 within expected timeframe for this item type and effort' : h === 'warning' ? 'Warning \u2014 approaching effort-adjusted time limit' : h === 'alert' ? 'Alert \u2014 significantly past expected completion time' : h === 'critical' ? 'Critical \u2014 far past expected completion, needs immediate attention' : 'Unknown'}"></span>${assignedStr}</span>
    <span>${stateStr}</span>
    <span>${detailIcon}</span>
  </div>`;
}

/**
 * Render the detail panel (linked items + PRs) for a work item.
 * @param {object} item - Work-item object
 * @param {object} options
 * @param {Array}  options.activePRs - Active PRs array (replaces ACTIVE_PRS global)
 * @returns {string} HTML string
 */
function renderDetailPanel(item, { activePRs = [] } = {}) {
  // PRs from work-item relations (linked in ADO)
  const linkedPrs = item.linkedPRs || [];

  // Also find active PRs by this item's assignee
  const assigneePrs = Array.isArray(activePRs)
    ? activePRs.filter(pr => pr.createdBy === item.assigned)
    : [];

  // Merge: show relation-linked PRs first, then assignee's active PRs (deduplicated by prId)
  const seenIds = new Set(linkedPrs.map(p => p.id).filter(Boolean));
  const extraPrs = assigneePrs.filter(pr => !seenIds.has(pr.prId));

  const childIds = item.childIds || [];

  const leftHtml = childIds.length
    ? childIds.map(cid => `<div class="detail-item">
        <span class="wi-type task" style="font-size:.6rem">child</span>
        <a href="${ADO_BASE}${cid}" target="_blank">#${cid}</a>
      </div>`).join('')
    : '<div class="detail-empty">No linked items</div>';

  let rightHtml = '';
  if (linkedPrs.length || extraPrs.length) {
    rightHtml = linkedPrs.map(pr => `<div class="detail-item">
        <span class="pr-pill has" style="font-size:.62rem">PR</span>
        <a href="${safeHref(pr.url || '#')}" target="_blank">${esc(pr.name || 'Pull Request')}</a>
      </div>`).join('');
    if (extraPrs.length) {
      rightHtml += extraPrs.map(pr => {
        const age = pr.createdDate ? daysBetween(new Date(pr.createdDate), new Date()) : null;
        const ageStr = age != null ? ` \u00B7 ${age}d` : '';
        return `<div class="detail-item">
          <span class="pr-pill has" style="font-size:.62rem">PR</span>
          <a href="${ADO_PR_BASE}${pr.prId}" target="_blank" title="${esc(pr.repo)} \u2192 ${esc(pr.targetBranch)}${ageStr}">${esc(pr.title)}</a>
          <span style="font-size:.65rem;color:var(--text-muted)">${esc(pr.repo)}${ageStr}</span>
        </div>`;
      }).join('');
    }
  } else {
    rightHtml = '<div class="detail-empty">No linked PRs</div>';
  }

  return `<div class="wi-detail">
    <div class="wi-detail-col"><h4>Linked Items</h4>${leftHtml}</div>
    <div class="wi-detail-col"><h4>Pull Requests</h4>${rightHtml}</div>
  </div>`;
}

/**
 * Render a parent + children group.
 * @param {object} group - { item, children }
 * @param {object} options - Passed through to renderRow / renderDetailPanel
 * @returns {string} HTML string
 */
function renderGroup(group, options = {}) {
  const hasKids = group.children.length > 0;
  let html = renderRow(group.item, { ...options, isChild: false, hasChildren: hasKids });
  for (const child of group.children) {
    html += renderRow(child, { ...options, isChild: true, hasChildren: false });
  }
  html += renderDetailPanel(group.item, options);
  const toggle = hasKids ? ' data-action="toggle-group"' : '';
  const collapseCls = hasKids ? ' collapsed' : '';
  return `<div class="wi-group${collapseCls}"${toggle}>${html}</div>`;
}

/**
 * Render a full item list with header and groups.
 * @param {Array}  groups - Array of { item, children } groups
 * @param {object} options - Passed through to renderGroup
 * @returns {string} HTML string
 */
function renderItemList(groups, options = {}) {
  if (!groups.length) return '<div class="empty-state">No items</div>';

  const CLOSED_STATES = new Set(['Closed', 'Resolved']);
  const openGroups = groups.filter(g => !CLOSED_STATES.has(g.item.state));
  const closedGroups = groups.filter(g => CLOSED_STATES.has(g.item.state));

  const header = `<div class="wi-header">
      <span>ID</span><span>Type</span><span>Title</span><span>State</span><span>Assigned</span><span>In State</span><span></span>
    </div>`;

  let html = header + openGroups.map(g => renderGroup(g, options)).join('');

  if (closedGroups.length) {
    const closedPts = closedGroups.reduce((s, g) => {
      let pts = g.item.storyPoints || 0;
      for (const c of g.children) pts += c.storyPoints || 0;
      return s + pts;
    }, 0);
    const ptsLabel = closedPts > 0 ? ` · ${closedPts} pts` : '';
    html += `<div class="closed-section collapsed" data-action="toggle-collapse" data-target=".closed-section">
      <h3 class="closed-section-header">✅ Closed / Resolved <span class="closed-count">${closedGroups.length} items${ptsLabel}</span> <span class="section-toggle">▶</span></h3>
      <div class="section-body">
        ${closedGroups.map(g => renderGroup(g, options)).join('')}
      </div>
    </div>`;
  }

  return html;
}

module.exports = { typeClass, renderRow, renderDetailPanel, renderGroup, renderItemList };
