// src/renderer/activity.js — Activity strip, change feed, and work patterns.
// Extracted from team-dashboard.js (Phase 1E).
"use strict";

const { ADO_BASE, SPRINT_TYPES, DONE_STATES } = require('../constants.js');
const { scoreHealth } = require('../health-scorer.js');
const { hasAiTag } = require('../data-utils.js');
const { esc } = require('../suggestions-engine.js');
const { renderSparkline, renderTeamTrend } = require('./velocity.js');

// ---------------------------------------------------------------------------
// renderActivityStrip— recent activity summary pills
// ---------------------------------------------------------------------------

function renderActivityStrip(people, appData) {
  const allItems = people.flatMap(p => p.items.map(i => ({ ...i, person: p.name })));

  const resolved = allItems.filter(i => DONE_STATES.has(i.state));
  const newItems = allItems.filter(i => i.state === 'New');
  const activeCount = allItems.filter(i => i.state === 'Active').length;

  const pills = [];

  const shown = resolved.slice(0, 5);
  for (const it of shown) {
    const short = it.title.length > 40 ? it.title.slice(0, 37) + '…' : it.title;
    pills.push(`<span class="activity-pill resolved">
      <span class="pill-icon">✓</span>
      <a href="${ADO_BASE}${it.id}" target="_blank" title="${esc(it.title)} — ${esc(it.person)}">#${it.id}</a> ${esc(short)}
    </span>`);
  }
  if (resolved.length > 5) {
    pills.push(`<span class="activity-pill resolved"><span class="pill-icon">✓</span>+${resolved.length - 5} more resolved</span>`);
  }

  if (pills.length && (newItems.length || activeCount)) pills.push('<span class="activity-sep"></span>');

  if (newItems.length) {
    pills.push(`<span class="activity-pill new-state"><span class="pill-icon">○</span>${newItems.length} item${newItems.length > 1 ? 's' : ''} still New</span>`);
  }

  if (activeCount) {
    pills.push(`<span class="activity-pill active-state"><span class="pill-icon">🔄</span>${activeCount} Active</span>`);
  }

  if (!pills.length) return '';
  return `<div class="activity-strip">
    <span class="activity-strip-label">Activity</span>
    ${pills.join('')}
  </div>`;
}

// ---------------------------------------------------------------------------
// renderChangeFeed — recent state changes grouped by day
// ---------------------------------------------------------------------------

function renderChangeFeed(items, appData) {
  const genDate = new Date(appData.generatedAt);
  const TYPE_ICON = { 'Task': '🔧', 'User Story': '📖', 'Bug': '🐛', 'Feature': '⭐' };
  const STATE_CLS = s => {
    const sl = s.toLowerCase();
    if (sl === 'new' || sl === 'ready to code') return 'st-new';
    if (sl === 'active') return 'st-active';
    if (sl === 'resolved') return 'st-resolved';
    return 'st-closed';
  };

  const entries = [];
  for (const item of items) {
    const days = item.age?.sinceStateChange;
    if (days == null || days > 3) continue;
    const changeDate = new Date(genDate);
    changeDate.setDate(changeDate.getDate() - days);
    entries.push({ item, changeDate });
  }
  entries.sort((a, b) => b.changeDate - a.changeDate);

  if (!entries.length) {
    return `<div class="change-feed">
      <div class="change-feed-header" data-action="toggle-open" data-target=".change-feed" title="Work items that changed state in the last 3 days. Shows who moved what and when — useful for standup prep and spotting stalled items.">
        <span class="cf-arrow">▶</span> 📋 Recent Changes
      </div>
      <div class="change-feed-body"><div class="change-empty">No state changes in the last 3 days</div></div>
    </div>`;
  }

  function dayLabel(d) {
    const diff = Math.round((genDate - d) / 864e5);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return `${diff} days ago`;
  }

  const groups = new Map();
  for (const e of entries) {
    const lbl = dayLabel(e.changeDate);
    if (!groups.has(lbl)) groups.set(lbl, []);
    groups.get(lbl).push(e);
  }

  let bodyHtml = '';
  for (const [label, groupItems] of groups) {
    bodyHtml += `<div class="change-day-header">${esc(label)}</div>`;
    for (const { item, changeDate } of groupItems) {
      const time = changeDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      const h = scoreHealth(item);
      const icon = TYPE_ICON[item.type] || '📋';
      const title = item.title.length > 60 ? item.title.slice(0, 57) + '…' : item.title;
      const person = item.assigned || 'Unassigned';
      bodyHtml += `<div class="change-entry">
        <span class="change-time">${time}</span>
        <span class="health-dot ${h}"></span>
        <span class="change-type-icon">${icon}</span>
        <span class="change-title" title="${esc(item.title)}">${esc(title)}</span>
        <span class="change-person" data-action="jump-to-person" data-name="${esc(person)}">${esc(person.split(' ')[0])}</span>
        <span class="change-state ${STATE_CLS(item.state)}">${esc(item.state)}</span>
      </div>`;
    }
  }

  return `<div class="change-feed">
    <div class="change-feed-header" data-action="toggle-open" data-target=".change-feed" title="Work items that changed state in the last 3 days. Shows who moved what and when — useful for standup prep and spotting stalled items.">
      <span class="cf-arrow">▶</span> 📋 Recent Changes <span class="change-feed-count">(${entries.length})</span>
    </div>
    <div class="change-feed-body">${bodyHtml}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// renderWorkPatterns — per-person workload signals with filter buttons
// ---------------------------------------------------------------------------

function renderWorkPatterns(people, appData) {
  const roster = appData.roster || {};
  const velocityPrev = appData.velocityPrev || {};
  const velocityHistory = appData.velocityHistory || { snapshots: [] };

  const rows = people.filter(p => p.name !== 'Unassigned').map(p => {
    const stories = p.items.filter(i => (i.type === 'User Story' || i.type === 'Bug'));
    const activeWIP = stories.filter(i => i.state === 'Active');
    const totalEffort = stories.reduce((s, i) => s + (i.storyPoints || 0), 0);
    const activeEffort = activeWIP.reduce((s, i) => s + (i.storyPoints || 0), 0);
    const blocked = p.items.filter(i => i.tags && i.tags.toUpperCase().includes('BLOCKED'));
    const silent = p.items.filter(i =>
      i.state === 'Active' && i.commentCount === 0 && i.age?.sinceChanged > 3
    );
    const lastVel = velocityPrev[p.name];
    const outOfSprint = p.items.filter(i =>
      SPRINT_TYPES.has(i.type) && i.sprintCategory !== 'current' && !['Closed', 'Removed'].includes(i.state)
    ).length;

    const aiItems = p.items.filter(i => hasAiTag(i.tags));

    const rosterEntry = roster[p.name] || {};
    const isCrossTeam = rosterEntry.crossTeam === true;

    return {
      name: p.name,
      activeWIP: activeWIP.length,
      totalEffort,
      activeEffort,
      blockedCount: blocked.length,
      silentCount: silent.length,
      lastVelPts: lastVel?.points ?? null,
      outOfSprint,
      isHoarding: activeWIP.length > 3,
      aiItemCount: aiItems.length,
      isCrossTeam,
    };
  });

  const teamTotalVel = rows.reduce((s, r) => s + (r.lastVelPts || 0), 0);

  for (const r of rows) {
    const vel = r.lastVelPts || 0;
    r.pctOfTeam = teamTotalVel > 0 ? Math.round((vel / teamTotalVel) * 100) : 0;
    const rosterEntry = roster[r.name] || {};
    const titleRole = rosterEntry.titleRole || '';
    const isNonEng = titleRole === 'pm' || titleRole === 'eng-manager' || !!rosterEntry.crossTeam;
    r.isRockstar = !isNonEng && r.pctOfTeam >= 20;
    r.needsSupport = !isNonEng && teamTotalVel > 0 && r.pctOfTeam <= 3 && vel >= 0;
    r.titleRole = titleRole;
    if (rosterEntry.rel === 'direct' || rosterEntry.rel === 'manager') r.group = 'team';
    else if (rosterEntry.crossTeam) r.group = 'cross-team';
    else if (rosterEntry.rel === 'peer') r.group = 'peers';
    else r.group = 'other';
  }

  const sortBySignal = (a, b) => {
    const aScore = (a.isHoarding ? 10 : 0) + a.blockedCount * 5 + a.silentCount * 2 + (a.needsSupport ? 3 : 0);
    const bScore = (b.isHoarding ? 10 : 0) + b.blockedCount * 5 + b.silentCount * 2 + (b.needsSupport ? 3 : 0);
    if (bScore !== aScore) return bScore - aScore;
    return (b.pctOfTeam || 0) - (a.pctOfTeam || 0);
  };

  if (!rows.length) return '';

  function renderWpRow(r) {
    const flags = [];
    if (r.isHoarding) flags.push(`<span class="wp-flag wp-hoard" title="${r.activeWIP} stories/bugs Active simultaneously — possible context switching">🔄 ${r.activeWIP} Active WIP</span>`);
    if (r.blockedCount) flags.push(`<span class="wp-flag wp-blocked" title="${r.blockedCount} item(s) tagged BLOCKED">🚫 ${r.blockedCount} Blocked</span>`);
    if (r.silentCount) flags.push(`<span class="wp-flag wp-silent" title="${r.silentCount} Active item(s) with no comments and no changes in 3+ days">🔇 ${r.silentCount} Silent</span>`);
    if (r.outOfSprint > 5) flags.push(`<span class="wp-flag wp-hygiene" title="${r.outOfSprint} items assigned but not in current sprint">🧹 ${r.outOfSprint} off-sprint</span>`);
    if (r.isRockstar) flags.push(`<span class="wp-flag wp-rockstar" title="Delivering ${r.pctOfTeam}% of team velocity — rockstar output, watch for burnout">🌟 Rockstar</span>`);
    if (r.needsSupport) flags.push(`<span class="wp-flag wp-support" title="Low velocity relative to team (${r.pctOfTeam}%) — may need support, could be blocked/ramping/cross-team work">🤝 Support Needed</span>`);
    if (r.isCrossTeam) flags.push(`<span class="wp-flag wp-crossteam" title="Splits time across multiple teams — lower velocity on this area path is expected">🔀 Cross-Team</span>`);
    if (r.aiItemCount > 0) flags.push(`<span class="wp-flag wp-ai" title="${r.aiItemCount} work item(s) tagged with AI tools (Cline, Copilot, etc.)">🤖 ${r.aiItemCount} AI</span>`);

    let velHtml = '';
    if (r.lastVelPts != null) {
      const ratio = r.lastVelPts > 0 ? (r.totalEffort / r.lastVelPts) : 0;
      const loadCls = ratio > 1.5 ? 'wp-overload' : ratio > 1 ? 'wp-heavy' : 'wp-ok';
      velHtml = `<span class="wp-load ${loadCls}" title="Current: ${r.totalEffort}pts vs last sprint: ${r.lastVelPts}pts">${r.totalEffort}/${r.lastVelPts} pts</span>`;
    } else {
      velHtml = `<span class="wp-load wp-nodata" title="No previous sprint velocity data">${r.totalEffort} pts</span>`;
    }

    const pctHtml = r.pctOfTeam != null && r.lastVelPts != null ? `<span class="wp-pct" title="${r.pctOfTeam}% of team velocity last sprint">${r.pctOfTeam}%</span>` : '<span class="wp-pct wp-nodata">—</span>';
    const sparkHtml = renderSparkline(r.name, velocityHistory);
    const flagsHtml = flags.length ? flags.join('') : '<span class="wp-clean">✓ Clean</span>';

    return `<div class="wp-row" data-group="${r.group}" data-action="select-person" data-name="${esc(r.name)}">
      <span class="wp-name" title="${esc(r.name)}">${esc(r.name)}</span>
      <span class="wp-effort">${velHtml}</span>
      <span class="wp-pct-cell">${pctHtml}</span>
      <span class="wp-spark-cell">${sparkHtml}</span>
      <span class="wp-flags">${flagsHtml}</span>
    </div>`;
  }

  const groups = [
    { key: 'team', label: 'My Team' },
    { key: 'peers', label: 'Peers' },
    { key: 'cross-team', label: 'Cross-Team' },
    { key: 'other', label: 'Other' },
  ];

  function buildGroupedHtml(filterKeys) {
    let html = '';
    for (const g of groups) {
      if (filterKeys && !filterKeys.includes(g.key)) continue;
      const groupRows = rows.filter(r => r.group === g.key).sort(sortBySignal);
      if (!groupRows.length) continue;
      html += `<div class="wp-group-label" data-group="${g.key}">${g.label}</div>`;
      html += groupRows.map(renderWpRow).join('');
    }
    return html;
  }

  const allHtml = buildGroupedHtml(null);
  const teamTrendHtml = renderTeamTrend(velocityHistory);

  return `<div class="work-patterns collapsed" data-action="toggle-collapse-wp">>
    <h3>📊 Work Patterns 
      <span class="wp-info" title="Shows who may be overloaded, hoarding work, blocked, or silent. Active WIP = stories/bugs in Active state. Silent = Active items with no comments and no changes in 3+ days. Click a person to see their full plate.">ℹ️</span>
      ${teamTrendHtml}
      <span class="section-toggle">▶</span>
    </h3>
    <div class="section-body">
      <div class="wp-filter-bar">
        <button class="wp-filter-btn active" data-action="filter-wp">All</button>
        <button class="wp-filter-btn" data-action="filter-wp" data-group="team">My Team</button>
        <button class="wp-filter-btn" data-action="filter-wp" data-group="peers,cross-team">Peers</button>
        <button class="wp-filter-btn" data-action="filter-wp" data-group="other">Other</button>
      </div>
      <div class="wp-header">
        <span>Person</span><span>Load vs Vel</span><span>%</span><span>Trend</span><span>Signals</span>
      </div>
      <div class="wp-rows-container">
        ${allHtml}
      </div>
    </div>
  </div>`;
}

module.exports = { renderActivityStrip, renderChangeFeed, renderWorkPatterns };
