---
name: sprint-planning
description: Automates biweekly sprint boundary work — closes current sprint, prepares next sprint, enforces team conventions (hierarchy, costing), orders backlog, and produces a visual HTML dashboard for the sprint planning meeting. Use when asked to "plan the sprint", "close the sprint", "sprint transition", "sprint boundary", "prepare next sprint", or "sprint dashboard".
---

# Sprint Planning Skill

## Purpose

Automates the operational overhead of biweekly sprint transitions for the engineering manager. Reduces sprint boundary work from 30–60 minutes to under 5 minutes of review + confirmation.

## What It Does

1. **Sprint Discovery** — Identifies current and next sprint from team iteration schedule
2. **Carryover** — Finds New/unassigned items, proposes moving to next sprint
3. **Hierarchy Fixes** — Detects Bug→Bug, Story→Story parent-child violations; fixes them
4. **Orphan Reparenting** — Finds items with no parent, reparents under Misc/Bugs
5. **Bug SP Enforcement** — Sets story points to 1 on uncosted bugs
6. **Backlog Ordering** — Orders features and items by team convention
7. **Compliance Handling** — Reparents compliance items to the compliance backlog
8. **Dashboard** — Generates a dark-themed HTML dashboard with load analysis, warnings, and talking points

## Tool

```
python .github/skills/sprint-planning/sprint_planning.py [options]
```

## Parameters

| Flag | Description | Default |
|------|-------------|---------|
| `--dry-run` | Read-only mode: analyze and show dashboard, no mutation proposals | off |
| `--skip-preflight` | Skip preflight validation (implies no mutations) | off |
| `--velocity N` | Override team velocity baseline | 36 SP |
| `--output MODE` | `canvas`, `file`, or `stdout` | `canvas` |

## Common Invocations

### Standard sprint transition
```powershell
python .github/skills/sprint-planning/sprint_planning.py
```

### Dashboard-only (no changes)
```powershell
python .github/skills/sprint-planning/sprint_planning.py --dry-run
```

### Custom velocity target
```powershell
python .github/skills/sprint-planning/sprint_planning.py --velocity 40
```

### Output to stdout (for piping)
```powershell
python .github/skills/sprint-planning/sprint_planning.py --dry-run --output stdout
```

## Approval Gate

Every mutation requires explicit confirmation:
- `confirm` — approve all proposed changes
- `skip` — reject all proposed changes  
- Comma-separated IDs — approve only specific items

The skill refuses to run in non-interactive mode (piped stdin).

## Audit Log

Every mutation is logged to `.github/skills/sprint-planning/audit-YYYYMMDD-HHMMSS.jsonl`. The log path is printed at session start. Each entry records: operation, item ID, field, old value, new value, and status.

### Reverting a bad reorder (recovery recipe)

Because every `set_stack_rank` entry records `old_value`, the audit log is a full
undo trail. To restore items to their pre-session `StackRank` (e.g. after an
over-broad reorder touched another team's items):

1. Collect the target item IDs.
2. Across **all of that day's** audit files (a reorder may span multiple runs),
   take the **earliest** `old_value` per `item_id` — that's the true original
   before the first write. Later entries only capture intermediate states.
3. `StackRank` is integer-valued; cast the recorded float (`"519.0"`) to int.
4. PATCH each item back: `az boards work-item update --id <id> --fields "Microsoft.VSTS.Common.StackRank=<orig>"`.
5. Spot-check a few against the audit to confirm.

If an item has no audit entry, it was never modified — leave it alone. If the
audit doesn't cover it, fall back to ADO work-item revision history.

## Canvas Output Contract

When `--output canvas` (the default), the skill writes a self-contained HTML file and emits two machine-parseable lines to **stdout**:

```
CANVAS_FILE: C:\path\to\dashboard.html
CANVAS_NAME: sprint-planning
```

All other diagnostic output goes to stderr. the agent reads stdout for these markers and calls the canvas tools:

- **First invocation** → `canvas_show(file=CANVAS_FILE, name="sprint-planning", port=9999)`
- **Subsequent invocations** → `canvas_update(name="sprint-planning")` (or `canvas_show` with `open_browser=False`)

The dashboard HTML is fully self-contained (inline CSS, no CDN dependencies) so no server is needed after initial render.

## Prerequisites

- ADO access to your `{ADO_PROJECT}` project
- Python 3.10+
- Jinja2 (`pip install jinja2`)

## Key ADO Artifacts

| Artifact | ID | Purpose |
|----------|----|---------|
| Misc/Bugs | 10000042 | Catch-all parent for orphaned items |
| Urgent Bugs | 10000043 | Top-priority bug container |
| Compliance backlog | 10000031 | compliance parent |

> Example IDs - replace with your own board's IDs. Configure your org/project via the ADO_ORG / ADO_PROJECT / ADO_AREA environment variables (or memory.md).

## Security Notes

- Tokens acquired fresh per invocation, never cached to disk
- All ADO-sourced strings are HTML-escaped in dashboard output
- Work item IDs validated as positive integers before use
- WIQL uses parameterized construction (no injection)
- Mutations require explicit user approval

## Implementation Notes

### Area Path Scope — the multi-area team board (read before any reorder)

The Sprint board is the **team** board, and a team owns
**multiple area paths**, not just `{your-area-path}`. Confirm
the live set from the team config, never assume:

```
az rest --resource 499b84ac-1321-427f-aa17-267ca6975798 --url \
  "{ADO_ORG}/{ADO_PROJECT}/{your-team}/_apis/work/teamsettings/teamfieldvalues?api-version=7.0"
```

The team may own several area paths (e.g. `{your-area-path}`, plus sibling
service areas). Read the live list from team field values — never hardcode it.
Some items may share the same iteration but belong to a different team; those
must **not** be reordered.

Two failure modes when scoping a reorder:
- **Too narrow** — filtering to a single `UNDER '{your-area-path}'` (what the
  deployed skill does today) is *safe* but misses sibling areas the board shows
  (e.g. other service areas the team owns).
- **Too broad** — filtering by **iteration only** (no area filter) sweeps in
  other teams' items that merely share the sprint. `StackRank` is a *single
  global field*; rewriting it on another team's items reorders **their** board.

The correct scope for ordering is **iteration ∩ team teamfieldvalues**.

> ⚠️ Example incident: a one-off group-reorder script ran with *no* area filter and
> rewrote `StackRank` on items belonging to another team (not ours). They were reverted to
> their pre-session values from the audit log. Never reorder by iteration alone.

### Hierarchy Fix Semantics

FR-007 specifies "convert the parent-child link to a Related link." The implementation uses a single PATCH per work item that: (1) sets `System.Parent` to the new parent (which ADO handles atomically — removing the old hierarchy link and adding the new one), and (2) adds `System.LinkTypes.Related` pointing back to the original parent. Both operations are combined in one PATCH request to satisfy FR-007's atomicity requirement. Idempotency: if the Related link already exists, it is not added again.

### Write Retry Semantics

ADO write operations (`PATCH /wit/workitems/{id}`) do **not** use automatic retry (per implementation plan T091). Blind write retry would risk double-applying mutations. Instead, the skill reads each item's current state before retrying any write (pre-write revalidation). Read operations (WIQL queries, batch fetches) use exponential backoff with up to 3 retries for 429/5xx responses, consistent with EC-02.

