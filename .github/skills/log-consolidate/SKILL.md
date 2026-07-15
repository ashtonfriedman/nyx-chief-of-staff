---
name: log-consolidate
description: >
  Consolidate .working-memory/log.md entries into memory.md — extract durable
  knowledge, discard ephemeral observations, trim to ~50 lines. Invoke when the
  boot check detects log.md over 80 lines, or when the user asks to "consolidate
  the log", "pass the log", or "run a log pass".
---

# Log Consolidation

## When to Run

- Boot check detects `.working-memory/log.md` > 80 lines (not optional).
- User explicitly asks.
- End of a long arc where the log has accumulated session-specific noise.

## Why It's Mechanical

Rules about "consolidate periodically" fail repeatedly. The 80-line threshold
is the mechanical fix — if you skip consolidation when triggered, the log grows
until it burns context window on stale entries.

## Procedure

1. **Read the entire log.** Every entry.
2. **Classify each entry**:
   - **Durable** → update `memory.md` in the right section (not appended to the
     bottom). Patterns, decisions, corrections, relationship context, workflow
     changes, initiative status shifts.
   - **Ephemeral** → discard. Session-specific observations, one-time context,
     "I noticed X" that didn't lead anywhere.
3. **Update `memory.md`** with the extracted knowledge. Place each item in the
   section it belongs to — don't dump everything at the bottom. Use the `edit`
   tool for targeted, surgical updates.
4. **Trim `log.md`** to the most recent ~50 lines. Cut from the top, keep the
   bottom. Preserve the top-level `# Working Memory — Log` heading as the first
   line.
5. **Commit immediately** via the `commit` skill. Don't let an in-progress
   consolidation sit dirty — a crash here loses work.
6. **Then** proceed with whatever the user originally asked for.

## Output

Announce: "log.md at {N} lines, running pass. {X} durable items routed into
memory.md, trimmed to {Y} lines."

## Related

- `.working-memory/memory.md` — destination for durable content
- `.working-memory/log.md` — source
- `.github/skills/commit/SKILL.md` — commit step
