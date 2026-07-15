---
name: specify
description: Generate a structured specification from a natural language idea. Use when the user says "specify", "write a spec", "define this feature", "I have an idea", "create a spec for", "new initiative", or wants to turn a vague concept into structured requirements.
---

# Specify — Idea → Structured Specification

Orchestrator skill that turns a vague natural language idea into a formal, validated specification. This skill does **not** write the spec itself — it delegates to the `specification-generator` agent and then runs quality validation. It is the entry point for the entire spec-driven pipeline.

## Phase 1: Gather Context

1. Capture the user's description (`$DESCRIPTION`). If empty, stop: *"No description provided."*
2. Determine the initiative slug:
   - If the user provided an explicit slug, use it.
   - Otherwise, derive a 2–4 word kebab-case slug in action-noun format (e.g., "add user auth" → `add-user-auth`).
3. Check `initiatives/[slug]/`:
   - **Exists with `spec.md`** → ask the user whether to overwrite or refine. If refining, direct to the `clarify` skill and stop.
   - **Exists without `spec.md`** → proceed (reuse the initiative directory).
   - **Does not exist** → create it.
4. Search `domains/` and `expertise/` for files relevant to the idea. Collect any found context to pass to the generating agent.
5. Load `SOUL.md` — constitution principles will be forwarded to the generating agent.

## Phase 2: Generate Specification

1. Invoke the `specification-generator` agent in **Phase 6b: Forward-Facing Specification** mode.
2. Provide the agent with:
   - The user's `$DESCRIPTION`
   - The initiative slug
   - Relevant context gathered from `domains/` and `expertise/`
   - A standard structured spec template with FR-###/SC-###/NFR-###/DM-###/US-## IDs
   - The constitution at `SOUL.md`
3. The agent produces `initiatives/[slug]/spec.md` containing properly numbered FR-###, SC-###, NFR-###, DM-###, and US-## identifiers, with at most 3 `[NEEDS CLARIFICATION]` markers.

## Phase 3: Quality Validation

1. Validate the produced spec against standard requirements-quality criteria: quality dimensions, ambiguity taxonomy, severity, and anti-patterns.
2. Check each of the following:
   - **Mandatory sections present**: User Scenarios, Functional Requirements, Non-Functional Requirements, Success Criteria, Out of Scope, Assumptions & Dependencies.
   - **ID conventions followed**: FR-###, SC-###, NFR-###, DM-###, US-## — sequential, no gaps.
   - **No prohibited patterns**: no vague adjectives without metrics, no implementation details in requirements.
   - **SOUL.md alignment**: any conflict is **CRITICAL** and blocks approval.
   - **Clarification cap**: maximum 3 `[NEEDS CLARIFICATION]` markers.
3. If validation fails:
   - List every failing item.
   - Ask the generating agent to fix (maximum **3 iterations**). The `specification-generator` agent validates once per invocation. This skill owns the retry loop — max 3 calls to the agent for fixes.
   - If still failing after 3 iterations, document remaining issues in the spec's notes section and warn the user.

## Phase 4: Summary Report

Report to the user:

- **Initiative slug** and spec path: `initiatives/[slug]/spec.md`
- **Counts**: FR, SC, NFR, DM, US
- **Open `[NEEDS CLARIFICATION]` markers** (if any), with each question summarized
- **Quality validation result**: pass or fail, with details on any failures
- **Suggested next step**:
  - `[NEEDS CLARIFICATION]` markers remain → suggest the `clarify` skill
  - Spec is clean → suggest the `implementation-planner` agent for task breakdown
  - SOUL violations found → they **must** be resolved before proceeding

## Rules

- This skill delegates spec writing to the `specification-generator` agent — never write the spec directly.
- The spec must follow a standard structured spec format.
- Maximum 3 `[NEEDS CLARIFICATION]` markers, prioritized: scope > security/privacy > UX > technical details.
- SOUL.md violations are **CRITICAL** and block approval — surface them immediately.
- If an existing `spec.md` is found, confirm with the user before overwriting — suggest `clarify` for refinement.
- Maximum 3 validation→fix iterations. After that, document issues and proceed.
- All ID conventions must be followed: FR-###, SC-###, NFR-###, DM-###, US-##.
- Spec must be technology-agnostic — no frameworks, languages, or databases in requirements.
- Success criteria must be measurable, user-facing, and verifiable without implementation knowledge.
