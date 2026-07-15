---
name: daily-dashboard
description: Renders the daily briefing as a visual HTML dashboard at localhost:9999. Use when user asks for "daily dashboard", "morning dashboard", "refresh dashboard", or "dashboard". Gathers the same data as daily-report but outputs structured JSON consumed by a JS renderer.
---

# Daily Dashboard Skill

## Purpose

Generate the daily briefing as a visual HTML dashboard served at `http://localhost:9999`. Same data as the `daily-report` skill, written to a JSON file that a self-contained JS template renders into a dark-themed, scannable web page.

## Architecture

The dashboard uses a **JSON + JS split**:

- **`dashboard-data.json`** — all data, config, and metadata. This is what the skill writes.
- **`daily-dashboard-v2.html`** — pure JS renderer. Fetches the JSON at page load and renders dynamically. Never edited by the skill.

Both files live in `.github/extensions/canvas/data/content/`.

The HTML template reads all configuration from the JSON `config` block — ADO org/project URLs, org flag lists, refresh intervals, timezone. Nothing is hardcoded in the renderer.

## How to Execute

### How to Execute (3 steps)

**Step 1: Run `dashboard.py`** — gathers ADO, M365, and Mind data in parallel (~30-45s):

```powershell
python .github/skills/daily-dashboard/dashboard.py --sections ado,m365,mind
```

Period prefix is auto-detected from ADO iteration paths. Override with `--period <prefix>` if needed.

**Step 2: Start action server + open browser:**

```powershell
# Check port, start action server (mode="async", NOT detach), open Edge
Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue
node .github/skills/daily-dashboard/server.js
Start-Process msedge "http://localhost:9999"
```

The action server (`server.js`) replaces the old inline static file server. It serves static files for the dashboard.

**Step 3 (optional): Calendar supplement** — `az` CLI lacks Calendar.Read scope, so calendar needs MCP:

```
calendar-ListCalendarView for today → merge todayMeetings into dashboard-data.json
```

Skip on weekends (no meetings). On weekdays, write a small Python script or use `--calendar-json` flag.

That's it. No manual JSON patching. No multi-phase orchestration.

### CLI Flags

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--org` | | ADO org URL | `{ADO_ORG_URL}` |
| `--project` | `-p` | ADO project | `{ADO_PROJECT}` |
| `--area` | `-a` | ADO area path | `{AREA_PATH}` |
| `--output` | `-o` | Output JSON path | auto |
| `--mind` | | Mind repo root | cwd |
| `--sections` | | Comma-separated: `ado,m365,mind,calendar,all` | `all` |
| `--period` | | Iteration prefix override (auto-detected if omitted) | auto |
| `--calendar-json` | | Pre-fetched calendar JSON path | — |

### Operational Notes

- **Port conflicts:** Check port 9999 before starting. Bind to `127.0.0.1`. Use `mode="async"` (not `detach: true`) for the server.
- **Auto-period:** Counts iteration path segments across active items, picks the most common non-Backlog prefix. Works as long as most items share a period iteration root.

### Phase 1: Gather Data

Follow the **exact same data-gathering steps** defined in `.github/skills/daily-report/SKILL.md` — Steps 1, 2, and 3 (including 3a, 3b, 3c, 3d).

Use `m365-query ask -q "..."` for M365 queries (not `skill(m365-query)` — m365-query is a CLI tool, not a registered skill).

As you gather data, collect results into the JSON schema buckets below.

**Important:** All date-relative queries ("today", "last 24 hours", "yesterday") resolve naturally to the current date at execution time. No dates are hardcoded.

### Link Extraction

When gathering decisions, action items, and open questions from chat rollups, **also ask M365 query tool for the specific message link** where each item was discussed. Use a follow-up query like:

```
m365-query ask -q "For the discussion about [topic] in [chat name] in the last 24 hours, give me the direct Teams message link (the URL with the messageId)."
```

Populate the `link` field with the `msteams://` version of the URL (replace `https://teams.microsoft.com/l/` with `msteams://teams.microsoft.com/l/`).

If M365 query tool can't return a specific message link, leave `link` null — the renderer handles missing links gracefully.

For `sourceLink`, use the known chat thread deep links:

| Chat | sourceLink |
|------|------------|
| {DEV_PM_CHAT} | `msteams://teams.microsoft.com/l/message/{CHAT_THREAD_ID}` |
| {TEAM_CHANNEL} | `msteams://teams.microsoft.com/l/message/{CHAT_THREAD_ID}` |
| {PARTNER_TEAM} Managers | `msteams://teams.microsoft.com/l/message/{CHAT_THREAD_ID}` |

### Mention Rules

**{DEV_PM_CHAT} chat:** Only include actual @mentions of the user — not general discussion or rollup items. Other chat rollup data (decisions, action items, open questions) still goes into their respective buckets, but the mentions card is strictly @mentions.

**Time window:**
- **Normal days:** last 24 hours
- **Mondays:** include Friday through Monday (cover the weekend gap)

**Org flagging:** Flag mentions from the user's direct reports, {PEER_PM}'s direct reports, and {PEER_PM} herself with a colored badge. The org lists are stored in `config.orgFlags` in the JSON. Use Graph to resolve current directs if the lists seem stale.

| Group | Badge | People |
|-------|-------|--------|
| Your team | green ★ | {TEAM_MEMBER} {TEAM_MEMBER}, {TEAM_MEMBER} {TEAM_MEMBER}, {DIRECT_REPORT}, {TEAM_MEMBER}, {TEAM_MEMBER}, {TEAM_MEMBER} |
| {PEER_PM}'s team | purple ★ | {PEER_TEAM_MEMBER}, {PEER_TEAM_MEMBER}, {PEER_TEAM_MEMBER}, {PEER_TEAM_MEMBER}, {PEER_TEAM_MEMBER} |
| {PEER_PM} | purple ★ | {PEER_PM} |

### Phase 2: Write JSON

Write all gathered data to `.github/extensions/canvas/data/content/dashboard-data.json`.

The JSON schema has these top-level keys:

```json
{
  "config": { ... },
  "meta": { ... },
  "overview": { ... },
  "schedule": { ... },
  "ado": { ... },
  "comms": { ... }
}
```

#### `security` block (optional — only present when threat-log.jsonl has entries)

```json
{
  "security": {
    "recentCount": 0,
    "totalAllTime": 0,
    "bySeverity": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
    "byTactic": { "prompt-injection": 0, "authority-spoofing": 0 },
    "threatDetections": [
      { "ts": "...", "source": "...", "tactic": "...", "content": "...", "response": "...", "severity": "..." }
    ],
    "skippedLines": 0
  }
}
```

To populate: read `.working-memory/threat-log.jsonl`, parse each line as JSON,
skip malformed lines (count as `skippedLines`), aggregate by severity and tactic,
sort detections newest-first. `recentCount` = entries from last 7 days.

Add `"security": 86400` to `config.refreshIntervals`.

#### `config` block (update if needed, otherwise preserve existing)

```json
{
  "timezone": "America/New_York",
  "refreshIntervals": {
    "ado": 21600,
    "m365": 3600,
    "mind": 0,
    "calendar": 3600
  },
  "adoOrg": "{ADO_ORG_URL}",
  "adoProject": "{ADO_PROJECT}",
  "adoAreaPath": "{ADO_PROJECT}\\{ADO_AREA_PATH}",
  "dashboardPort": 9999,
  "orgFlags": {
    "yourTeam": ["{TEAM_MEMBER} {TEAM_MEMBER}", "{TEAM_MEMBER} {TEAM_MEMBER}", "{DIRECT_REPORT}", "{TEAM_MEMBER}", "{TEAM_MEMBER}", "{TEAM_MEMBER}"],
    "teamAlpha": ["{PEER_TEAM_MEMBER}", "{PEER_TEAM_MEMBER}", "{PEER_TEAM_MEMBER}", "{PEER_TEAM_MEMBER}", "{PEER_TEAM_MEMBER}"],
    "leadership": ["{PEER_PM}"]
  }
}
```

#### `meta` block (update timestamps for each section you refresh)

```json
{
  "lastRefreshed": {
    "ado": "2026-03-17T05:40:00.000Z",
    "m365": "2026-03-17T05:40:00.000Z",
    "mind": "2026-03-17T05:40:00.000Z",
    "calendar": "2026-03-17T05:40:00.000Z"
  }
}
```

The renderer uses these timestamps + `config.refreshIntervals` to show ⚠ stale indicators when data is older than the configured interval.

#### `overview` section

| Field | Type | Source |
|-------|------|--------|
| `focusRecs` | `[{rank, text}]` | Your top 3 priority recommendations |
| `mentions` | `[{from, source, text, timestamp, link?}]` | @mentions (see Mention Rules) |
| `openQuestions` | `[{topic, text, relatedItem?}]` | From chat rollups |
| `decisions` | `[{topic, text, who, source, sourceLink?, style, link?}]` | From chat rollups + meeting recaps |
| `actionItems` | `[{assignee, text, source, sourceLink?, requestedBy?, deadline?, link?}]` | From chat rollups + meeting recaps |

For mentions, include a `link` field with `msteams://` protocol URL when available:
```
msteams://teams.microsoft.com/l/message/{threadId}/{messageId}?context=...
```

#### `schedule` section

| Field | Type | Source |
|-------|------|--------|
| `todayMeetings` | `[{time, title, attendees, notes, badge?, important?, dimmed?}]` | Today's calendar |
| `yesterdayRecaps` | `[{meeting, text}]` | Yesterday's meeting transcripts |
| `oneOnOnePrep` | `[{person, time, topics: [{label, text}]}]` | 1:1 prep data |

For meetings: set `dimmed: true` for conflicts/low-priority. Set `important: true` for VIP meetings. Use `badge: {color, text}` for status tags (e.g., `{color:"blue", text:"VIP"}`).

#### `ado` section

| Field | Type | Source |
|-------|------|--------|
| `currentPeriod` | `{label, items: [{id, type, title, state, created, parentId?, iteration, iterationShort, related?}]}` | Active ADO items in current period iterations |
| `futureAdo` | `[same shape as items]` | Items in Backlog or future period iterations |
| `adoCleanup` | `[{id, title, state}]` | Items in previous period iterations |
| `agingItems` | `[{id, title, created}]` | Current period items open >14 days |
| `recentlyCompleted` | `[{id, title, parentNote?}]` | Closed/Done in last 30 days |
| `stateChanges` | `[{id, title, fromState, toState}]` | State changes in last 24h |

**ADO queries must use `-o json`** (not `-o table`) to get IterationPath and System.Parent fields.

**Hierarchy:** Include `parentId` on child items. The renderer builds the tree client-side using `buildTree()`. Items without a parent in the dataset become roots.

**Period bucketing:**
- Current period: items in `{PRIOR_PERIOD}\*` iterations → `currentPeriod`
- Future: items in `Backlog` or future period (e.g., `{FISCAL_YEAR}\Q1`) → `futureAdo`
- Previous: items in past period iterations → `adoCleanup`

#### `comms` section

| Field | Type | Source |
|-------|------|--------|
| `urgentEmails` | `[{from, subject, needsReply?}]` | Urgent/VIP emails |
| `awaitingReply` | `[{from, subject, waitingOn}]` | Threads awaiting reply |
| `knowledgeDrops` | `[{title, text}]` | Interesting items from chats |
| `inboxNotes` | `[{text}]` | Inbox note summaries |
| `activeInitiatives` | `[{name}]` | Initiative folder names |
| `nextActions` | `[{source, items: [string]}]` | Grouped by source file |

### Phase 3: Start Server

Check if the dashboard server is already running on port 9999:
```powershell
Get-NetTCPConnection -LocalPort 9999 -ErrorAction SilentlyContinue
```

If not running, start a static file server:
```powershell
node .github/skills/daily-dashboard/server.js
```

Use `mode: "async"` (NOT `detach: true` — detached mode exits silently on this system).

Then open in Edge:
```powershell
Start-Process msedge "http://localhost:9999"
```

## Refresh Behavior

- When the user says "refresh dashboard", re-run data gathering for sections whose `lastRefreshed` timestamp exceeds their `refreshIntervals` threshold.
- Always update `meta.lastRefreshed` timestamps for any section you re-gather.
- The renderer adds a cache-busting `?_=timestamp` query param when fetching JSON, so updates appear on page reload.

## Constraints

- Read-only: never modify source systems (ADO, M365, etc.)
- No fabrication: if a query fails, note the failure in the relevant section and move on
- All CSS is inline in the HTML template — no external dependencies
- Dashboard works offline once JSON is populated (just need the local server)
- Use Eastern Time (America/New_York) for all displayed dates/times

## Data Post-Processing Recipes

These are specific gotchas learned from building the pipeline. Apply during Phase 2 (data assembly).

- **M365 query tool channel summary timeouts**: When channel summaries time out, `decisions`, `actionItems`, `openQuestions`, and `knowledgeDrops` come back as empty arrays. Fallback: fetch directly via `teams-ListChatMessages` for the 3 known channel IDs and synthesize those sections manually. Never serve empty sections.
- **yesterdayRecaps**: M365 query tool returns raw markdown with numbered citation links (`[1](https://...)`). Strip all citation links and split into one entry per meeting before writing to the dashboard JSON.
- **inboxNotes**: dashboard.py may return raw markdown file dumps. Post-process to clean one-line summaries before JSON is served.
- **ADO state changes**: The JSON payload is too large for PowerShell's `ConvertFrom-Json`. Use Python with `json.loads(chunk, strict=False)` and strip control chars first.
