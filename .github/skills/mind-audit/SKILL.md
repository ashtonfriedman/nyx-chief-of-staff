---
name: mind-audit
description: Audit and clean up mind repo files (rules, memory, domains, expertise). Use when asked to "audit rules", "clean up memory", "check for duplicates", "organize mind files", or "mind audit".
---

# Mind Audit

Systematic review of working memory and knowledge files to ensure every item lives in
the right place, nothing is duplicated, and the system stays lean.

## When to Run

- After a burst of new rules (5+ added without review)
- During consolidation cycles (log → memory)
- When rules.md or memory.md exceeds its target size
- On request ("audit my rules", "clean up memory")

## File Roles

Each file has a specific job. Misplacement creates noise, duplication, or blind spots.

| File | Contains | Test |
|------|----------|------|
| `rules.md` | Behavioral directives learned from mistakes | "If an agent violates this, something bad happens." |
| `memory.md` | Curated reference: architecture, conventions, active state | "An agent needs this to understand the landscape." |
| `domains/` | Facts about people, teams, projects, systems | "This describes how something IS." |
| `expertise/` | Durable patterns, techniques, reference material | "This is reusable knowledge beyond one system." |
| `initiatives/` | Active efforts with goals, status, next-actions | "This has a start, an end, and a current status." |
| Skill docs | Tool-specific processing instructions | "This is a recipe for operating a specific tool." |

## Phase 1: Classify Every Rule

Read `rules.md` line by line. For each entry, apply these tests in order:

### Test 1: Is it a behavioral directive?

A rule says DO or DON'T DO something. It has a verb and an actor.

- ✅ "Never use OData name filters for person-based email searches."
- ✅ "Check response status before listing meetings as commitments."
- ❌ "WebUX flags are app-wide booleans with query string overrides." (fact, not directive)
- ❌ "M365 query tool returns markdown with citation links." (describes behavior, doesn't direct action)

**If it's a fact without a directive**, it belongs in domains/ or expertise/.
**If it's a fact WITH a directive**, evaluate whether both are needed together.
Often the fact is context and the directive is the rule. Keep only what the agent
needs to avoid the mistake. Move the explanation elsewhere and cross-reference.

### Test 2: Is it a processing recipe for a specific tool?

Some "rules" are really step-by-step instructions for operating a particular skill,
dashboard, or pipeline. These belong in that tool's documentation.

- ❌ "Strip citation links and split into one entry per meeting before writing to dashboard JSON." → dashboard skill docs
- ❌ "Post-process inbox notes to clean one-line summaries before JSON is served." → dashboard skill docs
- ✅ "Don't serve an empty dashboard when channel summaries time out." → rule (behavioral)

**Move recipes to the tool's SKILL.md or a companion doc.** Leave a single behavioral
rule if one exists (e.g., "Validate all dashboard data before serving").

### Test 3: Is it duplicated?

Check whether the same fact or directive appears in:
- `memory.md` (common: technical reference sections mirror rules)
- Domain notes (system-specific facts restated as rules)
- Skill docs (processing steps restated as rules)

**Deduplication principle**: The rule stays in `rules.md` (it's the action).
The fact stays in its canonical home (memory, domain, or expertise).
Neither file should contain both the fact AND the action if they can cross-reference.

### Test 4: Can it consolidate?

Rules about the same topic that share a root cause can often merge:

- Before: "CLI --parent flag doesn't link reliably." + "CLI silently drops backslash paths." + "CLI truncates long descriptions."
- After: "az boards CLI is unreliable for creates/updates with hierarchy paths, long descriptions, or parent links. Use REST API. CLI is only safe for simple field updates."

**Merge rules that share a root cause and a single compensating action.**

## Phase 2: Cross-File Duplication

Scan for the same information appearing in multiple files:

1. Read `memory.md`. For each technical fact, check if `rules.md` has the same fact.
2. Read domain notes referenced by rules. Check for restated facts.
3. Flag duplicates with a recommendation: which file keeps it, which gets trimmed.

**Decision framework for duplicates:**
- Behavioral directive → `rules.md` owns it
- System architecture or API behavior → `memory.md` or domain note owns it
- Reusable pattern → `expertise/` owns it
- Active project state → `initiatives/` owns it

## Phase 3: Structural Health

Check for these common problems:

- **Orphan sections**: Rule sections with only 1 entry. Absorb into a parent section.
- **Misplaced items**: Rules filed under the wrong section header.
- **Stale rules**: Rules about systems, tools, or APIs that no longer apply.
- **Missing tags**: Rules without scope tags (`[all]`, `[chief_of_staff]`, etc.).
- **Tag drift**: Rules tagged for one agent that clearly apply to all (or vice versa).

## Phase 4: Present Findings

Output a summary table:

| # | Item | Current Location | Recommendation | Destination |
|---|------|-----------------|----------------|-------------|
| 1 | Feature flag mechanics | rules.md line 51 | Move fact, keep directive | domains/webux/ |
| 2 | Dashboard citation stripping | rules.md line 154 | Move to skill docs | daily-dashboard SKILL.md |

Group by action type:
1. **Move** — item belongs elsewhere
2. **Consolidate** — merge with another rule
3. **Trim** — remove redundant fact, keep directive
4. **Keep** — correctly placed, no action needed
5. **Stale** — remove entirely (system changed, rule no longer applies)

Present the full table for review. **Do not execute moves without approval.**

## Phase 5: Execute (after approval)

For each approved change:
1. Move content to its destination (update existing notes, don't create duplicates)
2. Update or remove the rules.md entry
3. Verify both files read correctly after the edit
4. If the destination note doesn't exist, check whether it should — sometimes the right
   answer is "create domain note" and sometimes it's "this fact doesn't need to be written down at all"

## Rules for the Audit Itself

- Never delete a rule without understanding why it was added. Check log.md for context.
- When in doubt about placement, ask. Some items genuinely straddle categories.
- Don't over-organize. A slightly messy rules file that gets read is better than a
  pristine taxonomy nobody can find anything in.
- The goal is signal-to-noise ratio, not architectural purity.
- Verify `mind-index.md` is current: every domain/, expertise/, and skill file should have an entry.
  Flag missing entries as part of the structural health check.
