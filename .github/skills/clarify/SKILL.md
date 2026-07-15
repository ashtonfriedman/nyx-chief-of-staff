---
name: clarify
description: Resolve ambiguities in an initiative spec through structured Socratic Q&A. Use when a spec has [NEEDS CLARIFICATION] markers, vague requirements, or when the user asks to "clarify", "refine the spec", "answer questions about the spec", or "resolve ambiguities".
---

# Clarify — Structured Ambiguity Reduction

Socratic Q&A protocol that resolves `[NEEDS CLARIFICATION]` markers and other ambiguities in an initiative spec. Asks up to 5 questions, one at a time, writing answers back into the spec incrementally.

## Inputs

- **`$INITIATIVE`** — initiative slug (required). Maps to `initiatives/$INITIATIVE/spec.md`.
- User may provide focus hints (e.g., "focus on security requirements").

## Phase 1: Taxonomy Scan

1. Load `initiatives/$INITIATIVE/spec.md`. If missing → abort with error, direct user to `specify` skill.
2. Load `SOUL.md` as the constitution.
3. Check `domains/` files for definitions that would auto-resolve terminology questions.
4. Scan spec against this **10-category ambiguity taxonomy**:

| # | Category |
|---|----------|
| 1 | Functional Scope & Behavior |
| 2 | Domain & Data Model |
| 3 | Interaction & UX Flow |
| 4 | Non-Functional Quality |
| 5 | Integration & External Dependencies |
| 6 | Edge Cases & Failure Handling |
| 7 | Constraints & Tradeoffs |
| 8 | Terminology & Consistency |
| 9 | Completion Signals |
| 10 | Misc/Placeholders |

5. Rate each category: **Clear** / **Partial** / **Missing**.
6. If no Partial or Missing categories → report "No critical ambiguities detected" and suggest proceeding to `implementation-planner`.

## Phase 2: Build Question Queue

1. Build an **internal prioritized queue** of ≤5 candidate questions. Do NOT reveal the queue to the user.
2. Only include questions whose answer **materially impacts** architecture, data modeling, task decomposition, test design, UX, or compliance.
3. Prioritize by `Impact × Uncertainty`. Tie-break order: scope > security/privacy > UX > technical details.
4. Aim for category coverage balance — don't ask 5 questions about the same category.
5. Exclude: already answered, plan-level execution details, tech stack unless it blocks functional clarity.
6. If `[NEEDS CLARIFICATION]` markers exist in the spec, those get priority in the queue.

## Phase 3: Sequential Questioning

Present exactly **ONE question at a time**.

**Multiple-choice questions:**
- State `**Recommended:** Option X — [1-2 sentence reasoning]` FIRST
- Render options table: `| Option | Description |`
- Add: "Reply with letter, say 'yes'/'recommended', or provide your own answer"

**Short-answer questions:**
- State `**Suggested:** [answer] — [brief reasoning]` FIRST
- User can accept with "yes"/"recommended"/"suggested" or provide their own

**Stop conditions** (whichever comes first):
- All critical ambiguities resolved early
- User says "done" / "stop" / "proceed"
- 5 questions asked (hard limit)
- Disambiguation retries for ambiguous answers do NOT count against the 5-question limit

## Phase 4: Incremental Spec Integration

After EACH accepted answer:

1. Ensure `## Clarifications` section exists in spec (create as the last section of the spec, after `## Assumptions & Dependencies`, per the spec template).
2. Under it, ensure `### Session YYYY-MM-DD` subheading exists.
3. Append: `- Q: [question] → A: [final answer]`
4. Apply clarification to the correct spec section:

| Ambiguity type | Target section |
|----------------|---------------|
| Functional ambiguity | Functional Requirements (FR-###) |
| Actor distinction | User Stories (US-##) |
| Data shape | Key Entities (DM-###) |
| Non-functional constraint | NFR-### (convert vague → metric) |
| Edge case | Edge Cases |
| Terminology | Normalize across spec; retain original once as "(formerly '[old term]')" |
| Interaction & UX flow | User Scenarios (US-## acceptance scenario), or Functional Requirements (FR-###) if behavior-level |
| Integration & external dependency | Assumptions & Dependencies → Dependencies subsection |
| Completion signal / definition of done | Success Criteria (SC-###) |
| Misc placeholder / TBD resolution | Nearest enclosing requirement; fall back to Assumptions & Dependencies |

5. **Replace** (do not duplicate) any statement the new answer invalidates.
6. Validate after each write: no duplicate clarification bullets, no lingering placeholders the answer was meant to resolve.
7. Delegate to `specification-generator` agent Phase 6c for any change that: (a) adds, removes, or renumbers an FR/SC/NFR/DM/US identifier, (b) touches more than one spec section, or (c) resolves a `[NEEDS CLARIFICATION]` marker. Edit directly only for single-sentence wording corrections within an existing requirement that don't affect IDs or section structure.

## Phase 5: Completion Report

Output:
- Questions asked / answered
- Spec file path
- Sections touched
- Coverage summary table: each taxonomy category → Resolved / Deferred / Clear / Outstanding
- Suggested next step: `implementation-planner` if clean, `clarify` again if outstanding items remain

## Rules

- Never exceed 5 questions total (retries for ambiguous answers don't count).
- Never reveal the question queue — present one question at a time.
- If spec is missing, direct user to `specify` skill — never create a new spec here.
- If no critical ambiguities found, report it and suggest proceeding — don't manufacture questions.
- `SOUL.md` principles are non-negotiable — if a user's answer conflicts with SOUL, surface the conflict explicitly.
- Always provide a recommended answer before asking — shift the burden from user to agent.
- The 5-question limit is per invocation. The max 3 `[NEEDS CLARIFICATION]` markers is a separate spec-level constraint.
- Warn if user explicitly skips clarification: "Downstream rework risk increases."
