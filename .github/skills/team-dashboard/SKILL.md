---
name: team-dashboard
description: >
  Generates a visual team health dashboard from Azure DevOps work items — velocity,
  per-person workload, and age-based health scoring across the current and previous
  sprint. Use when asked for a "team dashboard", "team health", "sprint velocity view",
  or "where is work aging".
---

# Team Dashboard

Builds a single-page HTML dashboard that summarizes a team's delivery health from ADO
work items: velocity trend, per-person load, and which items are aging past healthy
thresholds.

## Inputs

| Source | What it provides |
|--------|------------------|
| Azure DevOps | Work items for the current and previous sprint (queried by area path + iteration) |
| `sprint-config.example.json` | Copy to `sprint-config.json` and set your org, project, area path, and the two iteration paths to compare |

Configure ADO coordinates via environment variables (`ADO_ORG`, `ADO_PROJECT`,
`ADO_AREA`) or `sprint-config.json`. Never hardcode them.

## Pipeline

1. **Collect** — `python collect.py` (or `dashboard-collector.py`) queries the current and
   previous sprint, computes velocity and health, and writes a single `dashboard-data.json`.
2. **Enrich (optional)** — `enrich-roster.js` joins a roster file so display names and
   teams render cleanly.
3. **Normalize** — `normalize.js` shapes the raw query result into the dashboard schema.
4. **Embed** — `build-embed.js` inlines the data into `team-dashboard.html`.
5. **View** — open `team-dashboard.html`, or run `refresh-server.js` for live reload.

## Health Scoring

Items are scored by age (from ActivatedDate, falling back to CreatedDate) only while in
an **Active** state. Thresholds vary by work-item type (watch / warning / critical):

- **Tasks**: 5 / 14 / 28 days
- **User Stories**: 14 / 28 / 42 days
- **Bugs (P1–P2)**: 5 / 14 / 28 days
- **Bugs (P3+)**: 14 / 28 / 42 days
- **Features**: 42 / 84 / 126 days

New-state items are only flagged if very old (>6 months for Tasks, >1 year for
Stories/Features) to avoid noise on freshly created backlog.

## Velocity

Counts items moved to **Closed** or **Removed** in each sprint, grouped by assignee.
Trend is "up"/"down" when the sprint-over-sprint change exceeds 10%, otherwise "steady".

## Output

A self-contained `team-dashboard.html` plus the intermediate `dashboard-data.json`. The
HTML is safe to share as a static file — it embeds the data and needs no live ADO
connection to view.

## Rules

- Read ADO org/project/area from config or env vars — never commit real coordinates.
- The dashboard is a snapshot. Re-run the collector to refresh; don't hand-edit the JSON.
- Thresholds are tunable in the collector — adjust them to your team's work mix rather
  than treating the defaults as gospel.
