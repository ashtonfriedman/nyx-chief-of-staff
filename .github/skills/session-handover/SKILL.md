---
name: session-handover
description: >
  Close out a session cleanly — write a handover entry to log.md, commit the
  repo, and refresh the knowledge graph. Invoke when the user says goodbye,
  wraps up, or the conversation is clearly winding down. Skip trivial sessions
  that produced nothing worth preserving.
---

# Session Handover

Three steps, in order. Each one protects against a specific way a session's work
gets lost. Run this at the end of every working session — what you commit is what
survives into the next one.

> **Pairs with `mind-learn`.** Session handover preserves *session state* (what
> happened, what's pending, where to pick up). `mind-learn` preserves *durable
> knowledge* (domain facts, expertise, patterns). They are complementary, not
> redundant. A full close-out is usually: run `mind-learn` first (capture
> learnings), then `session-handover` (log state + commit + refresh graph). If
> the session produced no durable knowledge, you can skip `mind-learn` and just
> hand over.

## When to Run

- User says goodbye, "we're done", "thanks, that's it", or the conversation is
  clearly closing.
- A long, productive session is wrapping up.
- **Skip** for trivial sessions (single question, quick calendar check, no
  substantive work). If nothing in the context window is worth preserving, don't
  manufacture a handover entry. No ceremony for nothing.

## Step 1 — Log the handover entry

Append a concise handover entry to `.working-memory/log.md`. Keep it to **10 lines
or fewer** — the log is a pointer to where you left off, not a transcript. The log
gets consolidated when it grows past its threshold, so don't bloat it.

Include:
- **Date + register** — one line. What was the shape of the session? (Focused,
  scattered, frustrated, energized — future-you benefits from the emotional context.)
- **Key decisions / outcomes** — 2-4 lines. What changed and why it matters.
- **Pending items + state** — what's in flight and where it stands.
- **Next actions** — specific: name the file, the person, the exact next step.

Write directly with the `edit` tool (append at the bottom of `log.md`). If the
session was complex and won't fit in 10 lines, write the 10-line summary here and
drop the detail into `inbox/handover-detail-YYYY-MM-DD.md`.

## Step 2 — Commit the repo

Use the `commit` skill. The handover entry from Step 1 is part of this commit, so
the next session boots with it already on disk.

If the `commit` skill reports nothing to commit, that's fine — it means the session
made no durable changes. Note it and continue.

## Step 3 — Refresh the knowledge graph

Re-index the vault so the next session's boot snapshot reflects everything that
changed:

```
node graph/graph-cli.js index
```

This regenerates `.working-memory/graph-boot-context.md` — the materialized boot
context the agent reads at startup. If indexing fails (Node unavailable, etc.),
log the error and continue. The next boot will catch up; never block the handover
on the graph. (You can also invoke the `graph-index` skill, which wraps this.)

## Step 4 — Verify clean state

Run `git status`. If dirty files remain after the commit, something leaked — note
it in the handover log (or surface it to the user) rather than silently leaving it.
A clean tree means the handover is complete.

## Related

- `.github/skills/mind-learn/SKILL.md` — capture durable knowledge (run before handover)
- `.github/skills/commit/SKILL.md` — the commit step
- `.github/skills/graph-index/SKILL.md` — graph refresh wrapper
- `.github/skills/boot/SKILL.md` — the start-of-session counterpart
- `.github/skills/log-consolidate/SKILL.md` — keeps `log.md` trim over time
