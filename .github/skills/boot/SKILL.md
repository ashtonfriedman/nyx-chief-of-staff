---
name: boot
description: >
  Run the first-thing-every-session boot routine. Executes the boot-context
  script which reads the right files (SOUL.md, graph-boot-context.md, log.md)
  and runs the boot checks (time, git status, log line count, maintenance
  daemon status). Use at the start of every session.
---

# Boot

## What It Does

Run this once at the start of every session to orient:

```
node .github/scripts/boot-context.mjs
```

The script reads and reports:

1. The current time (set your timezone via the `MIND_TZ` env var or in
   `boot-context.mjs`).
2. `SOUL.md` — the agent's personality and voice.
3. `.working-memory/graph-boot-context.md` — the materialized vault index
   (the agent's pre-loaded orientation).
4. `.working-memory/log.md` — recent session observations (trimmed display
   when over 80 lines).
5. Git status — surfaces any dirty files before new work begins.
6. Log line count — flags when consolidation is needed.
7. Maintenance daemon status (mornings only) — confirms the overnight
   maintenance run succeeded.

`memory.md` and `rules.md` are **demand-loaded** — do not read them at boot.
Read them later, when a topic needs deep context.

## Actions On Boot Output

- **Dirty files** → surface them to the user before doing anything else.
- **Log over 80 lines** → run the `log-consolidate` skill, then commit.
- **Daemon failed** (morning only) → surface the warning.

## Notes

- If `graph-boot-context.md` is missing, fall back to reading
  `.working-memory/memory.md` and `.working-memory/rules.md` directly, then
  run the `graph-index` skill to regenerate the index.
- The boot script is read-only — it never mutates files.

## Related

- `.github/scripts/boot-context.mjs` — the boot routine
- `.github/skills/log-consolidate/SKILL.md` — log pass when over threshold
- `.github/skills/graph-index/SKILL.md` — regenerate the vault index
