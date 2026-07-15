---
name: feature-progress
description: Forward-looking planning period feature progress tracker. Shows committed feature completion, pace tracking, and delivery risk alerts. Use when asked about "feature progress", "period delivery", "committed features", "on pace", "at risk", "are we on track", "delivery confidence", or "what's behind".
---

# Feature Progress Skill

## Purpose

A forward-looking progress tracker for committed planning period features. Answers: "Are we on pace to deliver everything we committed this period, and what's at risk?"

Produces a self-contained HTML dashboard showing:
- **Period summary**: FP done/committed/remaining, sprints elapsed/remaining, status badge
- **Feature table**: every committed feature with state, completion %, pace status, expandable child stories
- **Alerts**: zero-progress features, behind-pace features, data quality warnings
- **Simple pace projection**: arithmetic extrapolation (not velocity modeling)

## How to Execute

```powershell
python .github/skills/feature-progress/main.py
```

### Parameters

| Flag | Description | Default |
|------|-------------|---------|
| `--org` | ADO organization URL | `{ADO_ORG}` |
| `--project` | ADO project name | `{ADO_PROJECT}` |
| `--area` | ADO area path | `{your-area-path}` |
| `--output` / `-o` | Output HTML file path | Auto-generated in temp dir |

Configure your org/project via the ADO_ORG / ADO_PROJECT / ADO_AREA environment variables (or memory.md).

### After Running

The skill outputs the path to an HTML file. Render it with:

```
canvas_show with file: <output_path> and name: "feature-progress"
```

## Feature Discovery Model

Features are discovered using a tiered model:

1. **Primary — Iteration path**: Features under `{FISCAL_YEAR}\Q4\Sprints` or `{FISCAL_YEAR}\Q1` iteration trees
2. **Secondary — Tags**: Features tagged `{FISCAL_QUARTER} Feature` or `Committed` (supplementary)
3. **Validation — Board position**: Checks separator items for data quality warnings only

**Exclusion tags** (`CutTag`, `{FISCAL_QUARTER} Cut`) always override inclusion signals.

## What It Shows

- **State badges**: Not Started, In Progress, Complete (with Blocked overlay)
- **Completion metrics**: Story count %, SP %, SP coverage
- **Pace classification**: On Pace 🟢, At Risk 🟡, Behind 🔴
- **Zero-progress alerts**: Features with no children or all-not-started, with latest-start dates
- **Simple pace projection**: FP done / sprints elapsed × sprints remaining (not burn rate)
- **Discovery provenance**: Which strategy found each feature

## Constraints

- **Read-only**: Never modifies ADO work items, tags, states, or fields
- **Runtime**: 1-3 minutes depending on feature count (progress reported to stderr)
- **Dark theme**: Self-contained HTML dashboard (`#0d1117` background)
- **No external dependencies**: Inline CSS/JS, no CDN references
- **Security**: All ADO strings HTML-escaped, IDs validated as integers, no PII beyond display names

## Known limitations

- **Blocked overlay can be a false positive.** A feature is flagged Blocked when
  any child carries a `BLOCKED` tag or blocked flag. Stale child tags produce
  phantom blocks — verify against the child before reporting (seen 2026-06-15:
  feature 10000032 flagged off a stale `BLOCKED` tag on child 10000033).
- **For "what's already closed / where are we this period," prefer ADO's
  Delivery Plan (timeline) report.** This skill is forward-looking and pace-
  oriented; the team backlog board API it leans on hard-excludes Closed
  features. To show Closed work, pull by iteration (`State='Closed'` UNDER
  `{FISCAL_YEAR}\Q1` / `{FISCAL_YEAR}\Q4`) and fold it in.

## Output Sensitivity

The dashboard contains internal project delivery data. Do not share externally without review. The output file should not be stored in cloud-synced folders or committed to version control.
