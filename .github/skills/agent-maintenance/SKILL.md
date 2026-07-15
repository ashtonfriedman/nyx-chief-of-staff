---
name: agent-maintenance
description: >
  Automated daily maintenance routine for the mind. Runs headless via Task Scheduler.
  Performs log consolidation, audit analysis (report only), graph re-index, and
  commit. Use when asked to "run maintenance", "do housekeeping",
  or triggered automatically by the scheduled task.
---

# Agent Maintenance

Autonomous housekeeping that runs without human input. This is you, doing your own
janitorial work on a schedule so the user never has to ask.

## When This Runs

- **Scheduled**: Daily at 5:00 AM ET via Windows Task Scheduler
- **Catch-up**: On logon or session unlock if the scheduled run was missed
- **Manual**: When the user says "run maintenance" or "do housekeeping"

When running headless (via `copilot -p`), this skill operates autonomously.
When running interactively, present findings and ask before committing.

## Prerequisites

The launcher script (`agent-maintenance.ps1`) handles:
- Idempotency (skip if already ran today)
- PID-based locking (prevent overlapping runs)
- State tracking (success/failure/timestamps)

This skill assumes those guards have already passed. Just do the work.

## Phase 1: Orient

Read the essentials. You need context but not the full boot ceremony.

1. Read `.working-memory/memory.md` — just the Architecture and Active Initiatives sections
2. Read `.working-memory/rules.md` — scan for rules tagged `[all]`
3. Read `.working-memory/log.md` — note current line count for Phase 2
4. Run `git status` — if dirty files exist, note them in the maintenance report but proceed

Do NOT run the full interactive boot sequence. Skip:
- Timezone confirmation (already stored)
- Interactive triage of dirty files

## Phase 2: Log Consolidation

Check `.working-memory/log.md` line count (noted in Phase 1).

- **Under 80 lines**: Skip. Log is healthy.
- **80+ lines**: Consolidate.
  - Read every entry. Classify: durable (→ memory.md) or ephemeral (→ discard).
  - Update `memory.md` with extracted knowledge in the correct sections.
  - Trim `log.md` to the most recent ~50 lines.

This is the same logic as the boot-check consolidation. The threshold and rules
are identical. The only difference: no human is watching, so be conservative about
what you classify as "durable." When in doubt, keep it in the log.

## Phase 3: Audit Analysis (Report Only)

**This phase produces a report. It does NOT execute any moves.**

The full mind-audit skill has a mandatory approval gate for moves. In headless mode,
we only identify problems and write them to a report file.

### 3a. Rules Classification Scan

Read `rules.md` line by line. For each entry, apply the mind-audit tests:
- Is it a behavioral directive? (belongs in rules)
- Is it a fact without a directive? (belongs in domains/ or expertise/)
- Is it a processing recipe for a specific tool? (belongs in that skill's docs)
- Is it duplicated in memory.md or a domain note?

### 3b. Cross-File Duplication Check

Scan for the same information in multiple files:
- Technical facts in both `rules.md` and `memory.md`
- Initiative state in both `memory.md` and `initiatives/`
- Person context in both `memory.md` and `domains/people/`

### 3c. Mind Index Reconciliation

Check `mind-index.md` against actual files:
- Files in domains/, expertise/, initiatives/ not listed in the index
- Index entries pointing to files that no longer exist

### 3d. Write Report

If any findings, write to: `inbox/maintenance-audit-YYYY-MM-DD.md`

Format:
```markdown
# Maintenance Audit — YYYY-MM-DD

## Rules Misplacement (N items)
| # | Rule (line) | Current | Recommendation | Destination |
|---|-------------|---------|----------------|-------------|
| 1 | "WebUX flags..." (L51) | rules.md | Move fact | domains/webux/ |

## Cross-File Duplication (N items)
| # | Content | File A | File B | Keep In |
|---|---------|--------|--------|---------|

## Mind Index Gaps (N items)
- Missing from index: `expertise/new-file.md`
- Stale index entry: `domains/old-team/` (deleted)

## Summary
{N} findings across {categories}. Review and approve moves in your next session.
```

If zero findings, skip the file. Don't create empty reports.

## Phase 4: Graph Re-Index

Run the graph indexer if any files were created or modified in Phases 2-3.

```powershell
node "graph/graph-cli.js" index
node "graph/graph-cli.js" context --output ".working-memory/graph-boot-context.md"
```

If graph-cli.js fails, log the error and continue. Don't block the commit.

## Phase 5: Commit

Check `git status`. If there are changes:

1. Stage all modified/new files: `git add -A`
2. Commit with message:
   ```
   chore: agent-maintenance — {date}

   Log: {consolidated|no change}
   Audit: {N findings written to inbox|clean}
   Graph: {re-indexed|skipped}
   ```
3. Do NOT `git push` — this is a local-only repo.

If no changes, skip the commit.

## Phase 6: Update State

Write results to the state file. The launcher script reads this.

The state file path is: `.github/scripts/data/agent-maintenance-state.json`

```json
{
  "last_run": "{ISO timestamp}",
  "last_success": "{ISO timestamp}",
  "status": "success",
  "pid": null,
  "error": null,
  "run_count": {N+1},
  "audit_findings": {count from audit},
  "log_consolidated": {true|false},
  "graph_reindexed": {true|false}
}
```

## Error Handling

- **Graph re-index failure**: Log error, continue. Graph staleness is tolerable.
- **Git commit failure**: Log error. Next boot's git status check will surface dirty files.
- **Any phase failure**: Log it, continue to next phase. Only mark "failed" if
  the critical path (commit) fails.

Status values:
- `"success"` — all phases completed
- `"partial"` — some phases skipped
- `"failed"` — critical failure (couldn't commit, couldn't read state)

## Rules

- **Never execute mind-audit moves.** Analysis only. The approval gate exists for a reason.
- **Be conservative with log consolidation.** When in doubt, keep entries in the log.
  False negatives (keeping ephemeral entries) are better than false positives
  (discarding durable observations) when no human is reviewing.
- **Don't manufacture output.** If nothing happened, say nothing. An empty maintenance
  run is a good maintenance run.

## Deployment

- The launcher script uses `$PSScriptRoot` for path discovery — no hardcoded paths.
- Task Scheduler registration uses the machine's local account.

To deploy on another machine:
1. Copy `.github/skills/agent-maintenance/` into the mind repo
2. Copy `.github/scripts/agent-maintenance.ps1` and `Register-AgentMaintenance.ps1`
3. Run `Register-AgentMaintenance.ps1` on that machine
4. Verify with a manual dry-run
