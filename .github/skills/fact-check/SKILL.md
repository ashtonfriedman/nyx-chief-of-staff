---
name: fact-check
description: Verify factual claims before presenting them. Counter-hypothesis testing for external facts, dates, URLs, attributions, and repo claims. Use when asserting something the user will treat as authoritative.
---

# Fact-Check

A structured verification pass that tests claims against available evidence before presenting them as fact.

Source: squad-skills framework

## When to Invoke

Invoke when presenting **synthesized claims the user may act on** — facts the agent assembled, summarized, or inferred rather than raw passthrough of API data or user-provided input.

Specifically:
- Synthesized summaries of API-backed data (e.g., describing what a work item says, summarizing a chat thread)
- Creating/updating ADO work items (descriptions, repro steps, success criteria)
- Citing dates, numbers, or statistics
- Attributing statements or decisions to people ("Tom reported X", "Jason's team decided Y")
- Codebase claims derived from search results
- Absence claims ("no file exists", "no message found")
- Current-state claims ("this is the current status")

## When NOT to Invoke

- Raw passthrough of quoted API fields (e.g., displaying a calendar event exactly as returned)
- Routine drafting, opinions, or planning
- Log entries or internal observations
- When the user explicitly provided the information being repeated back
- Simple Q&A where the agent isn't asserting facts

This skill is for moments where the agent synthesizes something factual — not every response.

## Skill Boundaries

| Skill | Domain |
|-------|--------|
| `fact-check` | Verify factual substrate — did this actually happen/exist? |
| `analyze` | Assess consistency and quality across artifacts |
| `clarify` | Resolve ambiguity by asking the user questions |
| `reflect` | Capture durable behavioral learnings |

If unsure whether a problem is factual (fact-check) or ambiguous (clarify): if the answer exists in a source you can check, it's fact-check. If it requires human judgment, it's clarify.

## Methodology

For each claim being presented:

### 1. Identify the Claim Type

Classify as one or more of:

| Type | Example |
|------|---------|
| External fact | "Azure Functions supports .NET 8" |
| Date/number | "The sprint ends June 20" |
| Repo/history claim | "This was changed in PR #42" |
| URL/link | "Documentation is at example.com/..." |
| Attribution | "Tom reported the sync failure" |
| Absence claim | "No file matching auth*.json exists" |
| Inference/summary | "Tom reported a 409 conflict" (vs. what Tom literally said) |
| Current-state claim | "The feature is currently in Active state" |
| Cross-system mapping | "Work item 12345 corresponds to PR #67" |

### 2. Decompose Compound Claims

Break compound claims into atomic subclaims before verifying. Each subclaim should isolate one verifiable element:

- **Actor** — who did/said it?
- **Source** — where was it said/done?
- **Date/time** — when?
- **Artifact/path/ID** — what specific thing?
- **Exact statement** — what was literally said vs. what you're summarizing?
- **Causal interpretation** — is the "because" part verified or inferred?
- **Currentness** — is this still true right now?

Example: "Tom reported on June 12 that profile sync fails with a 409 conflict because of race conditions in the batch pipeline" decomposes into 5+ atomic subclaims.

### 3. Counter-Hypothesis Test

For each atomic subclaim, ask "what would disprove this?" and actively check for it. If you can't think of what would disprove it, you don't understand the claim well enough to assert it.

### 4. Evidence Check

Verify against the actual source — don't rely on memory or prior context.

| Claim Type | How to Verify |
|------------|---------------|
| File/code reference | Read the actual file, confirm it exists and contains what you're claiming |
| ADO work item field | Re-read the work item via API before describing its contents |
| URL/link | Fetch it, confirm it resolves |
| Date/number | Cross-reference against source (calendar event, ADO field, email timestamp) |
| Attribution | Search for the actual message/email/meeting note where the person said it |
| Historical claim | Query session_store to verify it happened as described |
| Absence claim | Run at least two different search strategies before asserting something doesn't exist |
| Inference/summary | Compare your summary against the literal source text — flag any added details |
| Current-state claim | Re-query the current state; don't rely on cached or prior-turn data |
| Cross-system mapping | Verify both sides of the mapping independently |

### 5. Status Assignment

- ✅ **Verified** — confirmed against source
- ⚠️ **Unverified** — can't confirm, but no counter-evidence found
- ❌ **Contradicted** — evidence contradicts the claim

### Impossible Verification Fallback

When verification is impossible (no API access, source unavailable, data deleted):

- **Do not present as fact.** Never upgrade unverifiable claims to factual assertions.
- **Non-essential claim** → omit it entirely
- **Essential claim** → mark explicitly as unverified, or ask the user for the source
- **ADO work items** → separate **observed facts** (from API/messages) from **hypotheses** (agent interpretation) using clear labels

## Output

### Explicit Mode (skill invoked directly)

```
## Fact Check Report

**Claims checked**: N | **Verified**: N | **Issues**: N

| # | Claim | Status | Evidence |
|---|-------|--------|----------|
| 1 | [claim text] | ✅ Verified | [how verified] |
| 2 | [claim text] | ⚠️ Unverified | [what's missing] |
| 3 | [claim text] | ❌ Contradicted | [counter-evidence] |

**Verdict**: PASS / PASS WITH NOTES / NEEDS REVISION
```

Verdict definitions:
- **PASS** — all claims verified
- **PASS WITH NOTES** — some unverified, none contradicted
- **NEEDS REVISION** — any contradicted, or any required claim unverifiable

### Inline Mode (part of another task)

Don't produce the full report. Apply this decision tree silently:

| Status | Action |
|--------|--------|
| ✅ Verified | State normally |
| ⚠️ Unverified, non-critical | Label as unverified in output (e.g., "reportedly", "unconfirmed") |
| ⚠️ Unverified, required | Ask the user for source, or omit and explain what's missing |
| ❌ Contradicted | Correct the claim using the counter-evidence, or remove it |

**Hard rule: never invent missing details.** If evidence is partial, present what you have and flag what's missing — don't fill gaps with plausible fiction.

## Examples

### Example 1: Catch — fabricated bug description

> Task: Create a bug for the profile sync failure Tom reported.
>
> **Claim**: "Tom reported that profile sync fails with a 409 conflict when two updates race."
>
> **Counter-hypothesis**: What if Tom didn't say 409, or didn't mention racing?
>
> **Check**: Search Teams messages from Tom about profile sync.
>
> **Result**: ❌ Tom said "profile sync is broken for new hires" — no mention of 409 or race conditions. The agent fabricated the technical details.
>
> **Action**: Revise bug description to match what Tom actually said. Add the 409/race theory as a separate investigation note, clearly marked as unverified.

### Example 2: Pass — verified date claim

> Task: Summarize the sprint review decisions.
>
> **Claim**: "The team decided on June 12 to defer the caching feature to next sprint."
>
> **Counter-hypothesis**: What if the date was wrong, or the decision was different?
>
> **Check**: Search session_store for sprint review notes around June 12. Found checkpoint: "Sprint review 2025-06-12 — caching feature deferred to S14 per capacity constraints."
>
> **Result**: ✅ Date, decision, and rationale confirmed.

### Example 3: Catch — stale file reference

> Task: Update the onboarding doc to reference the auth config.
>
> **Claim**: "Auth configuration lives in `src/config/auth-settings.json`."
>
> **Counter-hypothesis**: What if the file was moved or renamed?
>
> **Check**: `glob("**/auth-settings.json")` — no results. `grep("auth-settings")` — found reference in a deleted PR. `glob("**/auth*.json")` — found `src/config/auth.config.json`.
>
> **Result**: ❌ File was renamed. Correct path is `src/config/auth.config.json`.
>
> **Action**: Use the correct path in the onboarding doc.
