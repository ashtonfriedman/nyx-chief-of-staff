---
name: reflect
description: Classify observations into rules, memory updates, or log entries using structured reflection. Use when corrected, when patterns emerge, or at session end for a learning sweep.
---

# Reflect

Structured classification and routing for observations before they enter the memory system. Ensures corrections become rules immediately instead of languishing in the log.

Source initiative: squad-skills framework

## Memory System

| File | Purpose | Persistence |
|------|---------|-------------|
| `.working-memory/log.md` | Raw chronological observations, append-only | Temporary — consolidated periodically |
| `.working-memory/rules.md` | Operational rules learned from mistakes, tagged by scope | Durable |
| `.working-memory/memory.md` | Curated long-term reference (architecture, workflows, people, context) | Durable |

## When to Invoke

Invoke when all of the following are true:

1. **Trigger detected** — one of:
   - **Explicit correction** — user says "no", "wrong", "don't do that", "that's not how we..."
   - **Explicit confirmation** — user says "yes, always do it that way", "good, keep doing that"
   - **Decision or architectural choice shared** — user communicates a durable decision

2. **Durability test passes** — the observation:
   - Changes behavior beyond this specific task or session
   - Is phrased as an invariant, preference, or policy (not local task steering)
   - Uses meta-language ("always", "from now on", "in general", "never") or is a repeated pattern

If "yes" or "no" is just local task steering (e.g., "yes, send that email"), don't fire.

## When NOT to Invoke

Do **not** invoke for:

- Routine task execution (filing work items, sending emails, running queries)
- Simple Q&A that doesn't reveal a preference or decision
- Routine mechanics of calendar, email, or Teams operations (but DO fire if the interaction reveals a durable preference — e.g., user consistently removes formal greetings from drafted emails)
- Observations already captured in a previous reflection
- Temporary context that won't matter next session

The goal is signal, not ceremony. If you're unsure whether something is worth reflecting on, it probably isn't — log it at `[LOW]` and move on.

## Routing Logic

Classify each observation into one canonical destination. Optionally add a log trace for provenance.

Before proposing a rule, check `rules.md` for existing coverage — don't duplicate.

### → `rules.md` (immediate, requires approval)

The observation is an **explicit correction, prohibition, or invariant**.

Signals: "never", "always", "don't", "wrong", "stop doing", "from now on", user undoes or rejects agent output.

Format the rule as a one-liner with a scope tag from the existing model (`[all]`, `[chief_of_staff]`, `[coding]`, or agent-specific like `[product_storyteller]`):

```
- [all] Never create markdown planning files in the repo — work in memory or session state.
- [chief_of_staff] Always include next-action owners when summarizing meeting outcomes.
```

### → `log.md` as memory candidate (no approval needed now)

The observation is **durable reference that will be needed across sessions** — architecture decisions, workflow changes, relationship context, team structure changes, tooling preferences.

Tag with `[MEMORY CANDIDATE]` so it gets promoted to `memory.md` during the next consolidation review. Do NOT write directly to `memory.md` — that happens only during consolidation.

```
→ log.md: [MEMORY CANDIDATE] PE analysis runs as a batch pipeline (owned by Jason's team), not inline during triage. Target section: ## Architecture / PE Analysis
```

### → `log.md` (append, no approval needed)

**Everything else** — session observations, one-time context, exploratory notes, unconfirmed patterns.

Tag each entry with a confidence marker:

| Tag | Meaning | Example |
|-----|---------|---------|
| `[HIGH]` | Strong user signal that didn't meet the rule threshold | User said "good approach" (confirmation, but not a durable policy) |
| `[MED]` | Inferred pattern from user behavior (modified-but-accepted, repeated preference) | User edited the draft to remove bullet points — prefers prose? |
| `[LOW]` | Agent's own observation, unconfirmed | This codebase seems to prefer early returns over nested conditionals |

## Approval Gate

**Only rules require immediate approval.** Memory candidates and log entries do not.

For rules, present:

```
📝 Reflect: I detected [trigger type].

Proposed rule: "[the rule text]"
Scope: [all/chief_of_staff/coding/etc.]

Apply to rules.md? [Y/n/edit]
```

If multiple rule candidates emerge in one session, batch them:

```
📝 Reflect: 2 rule candidates detected this session.

1. [all] "[rule text]" — triggered by [what happened]
2. [coding] "[rule text]" — triggered by [what happened]

Apply all / edit one / skip? [all/1/2/skip]
```

Wait for confirmation before writing to `rules.md`.

## End-of-Session Sweep

**Not automatic.** Run only when:
- Explicitly requested ("run reflect on this session")
- Triggered as a lightweight sub-step during handover — surfaces only uncaptured **rule candidates**

Do NOT duplicate the handover procedure's existing work (key decisions, pending items, next steps). Focus exclusively on behavioral learnings that should become rules or memory candidates.

## Examples

### Example 1: Explicit Correction → Rule

> **User**: No, don't create separate files for each ADO query. Inline the WIQL in the skill file.

```
📝 Reflect: I detected an explicit correction (prohibition).

Proposed rule: "[all] Inline WIQL in the skill file — do not create separate query files."
Scope: [all]

Apply? [Y/n/edit]
```

### Example 2: Architecture Decision → Memory Candidate

> **User**: We decided to move all PE analysis to a batch pipeline instead of doing it inline during triage. Jason's team owns it.

*(No approval needed — appended directly to log with candidate tag)*

```
→ log.md: [MEMORY CANDIDATE] PE analysis runs as a batch pipeline (owned by Jason's team), not inline during triage. Target section: ## Architecture / PE Analysis
```

### Example 3: Inferred Pattern → Log Entry

The user modifies a drafted email to remove the formal greeting and sign-off for the third time this week.

*(No approval needed — appended directly)*

```
→ log.md: [MED] User consistently removes formal greetings/sign-offs from drafted emails. Possible rule candidate on next consolidation.
```
