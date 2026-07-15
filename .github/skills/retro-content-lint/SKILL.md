---
name: retro-content-lint
description: Validate retro/RCA/postmortem documents against content standards before external distribution. Scans for HR context leaks, agent name exposure, blame language, unsourced claims, and other content rule violations. Use when asked to "review a retro", "lint this RCA", "check this postmortem", "validate this incident report", or before any retro/RCA document goes to an external audience.
---

# Retro Content Lint

Validates retro, RCA, and postmortem documents against content rules learned from live incident review sessions. Catches violations that would embarrass, confuse, or harm if published externally.

Source rules: `.working-memory/rules.md` § Retro & Incident Content, plus the rule definitions below.

## When to Invoke

Invoke when:

- User asks to "review a retro", "lint this RCA", "check this postmortem before sending", "validate this incident report"
- A retro/RCA/postmortem document is about to go to an external audience (the incident tracker form, email to leadership, cross-team share)
- User asks to "check this before sending" on any incident-related document
- Before copy-pasting retro content into the incident tracker fields or external-facing wikis

## When NOT to Invoke

- Internal working notes, incident call analysis, scratch investigation docs (unless user explicitly asks)
- Documents the user has already sent — lint before sending, not after
- Non-incident documents (specs, plans, meeting notes) — different rules apply

## Skill Boundaries

| Skill | Domain |
|-------|--------|
| `retro-content-lint` | Content rule validation for incident documents |
| `fact-check` | Verify factual claims are accurate and sourced |
| `analyze` | Cross-artifact consistency and quality audit |

If a document has both factual accuracy issues AND content rule violations: run `retro-content-lint` first (content rules are faster and block distribution), then `fact-check` for claim verification.

## Inputs

| Parameter | Required | Description |
|-----------|----------|-------------|
| `$DOCUMENT` | Yes | Path to the markdown file to lint |
| `$MODE` | No | `external` (default, all rules) or `internal` (relaxed, rules 1–3 only) |

If `$MODE` is not specified, infer from the document:
- Contains the incident tracker form fields, "Customer Impact", "Repair Items", "Detection and Mitigation" → `external`
- Contains "prep", "working", "analysis", "notes" in filename AND lacks the incident tracker form structure → `internal`
- When in doubt, default to `external` — false-strict is safer than false-relaxed

## Rules

Nine rules organized by severity. Rules 1–5 are **BLOCK** (hard stops — document cannot go external). Rules 6–9 are **WARN** (should fix before sending, but not automatic blockers).

### BLOCK Rules (must fix before external distribution)

#### Rule 1 — No personal availability or leave status

> Never put personal availability or leave status in RCA content. That's HR context, not root cause analysis.

**Scan for**: availability status, OOF, vacation, leave, "was out", "wasn't available", "on vacation", "out of office", "not reachable", "unavailable due to", "personal day", "sick", calendar references explaining someone's absence.

**Exceptions**: Do NOT flag "leave" when used in a non-HR sense (e.g., "leave the pipeline running", "leave the setting enabled"). Do NOT flag descriptions of process gaps that don't reveal individual leave status (e.g., "No backup IM was designated" is fine — it describes the gap without naming who was out or why).

**Why it blocks**: HR context in an RCA implies someone's absence caused the incident. That's a liability risk and a cultural violation.

**Fix pattern**: Remove the availability reference entirely. If the absence is operationally relevant, reframe as a process gap: "No backup IM was designated" instead of "The on-call engineer was unavailable."

#### Rule 2 — No agent names in external documents

> Never put agent names in external-facing documents. Use real names or team attribution only.

**Scan for**: the agent's name (from SOUL.md), "the agent", "AI agent", "copilot agent" when referring to work done by the agent as an actor, "{agent}'s analysis", "{agent}'s review", "the agent identified".

**Exceptions**: Do NOT flag the agent's name when used in an unrelated context (e.g., a person who happens to share the name). Context matters.

**Why it blocks**: External audiences don't know what the agent name means. It leaks internal tooling details and confuses readers.

**Fix pattern**: Replace with the human operator's name or "the team". "{Agent}'s analysis" → "the team's analysis". "the agent identified the root cause" → "Codebase investigation identified the root cause."

#### Rule 3 — No coaching instructions mixed with content

> Don't mix coaching instructions with deliverable content. Instructions for the agent ≠ content for the audience.

**Scan for**: Imperative meta-instructions embedded in deliverable text — "make sure to", "remember to", "don't forget to", "TODO:", "NOTE TO SELF:", "FIXME:", "[PLACEHOLDER]", "fill this in", "update this before sending", "check with [person]", "verify before publishing".

**Exceptions**: Do NOT flag action items in a repair items section (those are genuine action items, not coaching instructions). Do NOT flag HTML comments (`<!-- ... -->`) — those are source annotations, not audience-facing content.

**Why it blocks**: Instructions to the author appearing in the deliverable makes the document look unfinished and unprofessional.

**Fix pattern**: Either execute the instruction and remove it, or delete it if it's no longer relevant.

#### Rule 4 — Real names only in formal documents

> Always use real names in formal documents. Nicknames are private shorthand.

**Scan for**: Known nicknames used in place of full names. Common patterns in this repo:
- "{TEAM_MEMBER}" → "{TEAM_MEMBER}"
- "Sam" / "{TEAM_MEMBER}" (last-name-only) → "Sam Rivera" (last-name-only is acceptable in technical context but not in formal attribution)
- Any informal name that wouldn't appear in an org chart

**Context sensitivity**: Last-name-only references (e.g., "{TEAM_MEMBER}", "{STAKEHOLDER}", "{TEAM_MEMBER}") are acceptable in technical narrative after the full name has been introduced. Flag only when the nickname is the *only* reference to a person (no full-name introduction earlier in the document).

**Why it blocks**: External readers may not know who "{TEAM_MEMBER}" is. Formal documents should use names that can be looked up.

**Fix pattern**: Replace with full name on first reference; subsequent references can use last name.

#### Rule 5 — Separate upstream vs downstream impact numbers

> Separate upstream vs downstream impact numbers in incident reports. Never conflate another team's blast radius with your confirmed impact.

**Scan for**: Impact sections that present a single number without attribution. Patterns:
- "~50,000 users affected" without specifying whether that's upstream-reported or downstream-confirmed
- Mixing upstream-reported counts with downstream-verified counts in the same sentence
- "Total impact: [number]" that combines upstream and downstream

**Exceptions**: Do NOT flag impact sections that already use clear upstream/downstream subsections or explicit attribution (e.g., "upstream-reported" vs "downstream-confirmed"). Do NOT flag single-source incidents where upstream and downstream are the same team — separation only matters when multiple teams' blast radii are involved.

**Why it blocks**: Conflating another team's blast radius with your confirmed impact either understates your ownership or overstates your damage. Both are problems in formal incident review.

**Fix pattern**: Always qualify: "The upstream team reported ~50,000 active users with nulled attributes upstream. Downstream-confirmed impact: 40 of 150 groups potentially affected." Use separate subsections (### Upstream / ### Downstream) when the numbers are complex.

### WARN Rules (review before sending)

#### Rule 6 — Depersonalize blame for presentation

> "We don't name names in retros. We name events."

**Scan for**: Individual names in blame-adjacent context. Patterns:
- [Person] + "caused", "failed to", "missed", "broke", "didn't", "should have", "was responsible for"
- "If [person] had..." (counterfactual blame)
- "[Person]'s mistake" / "[Person]'s error"

**Exceptions**:
- Names in attribution of *positive* actions ("{STAKEHOLDER} created the the incident tracker", "{TEAM_MEMBER} executed the fix") — those are fine
- Names in timeline events ("the incident tracker created by {STAKEHOLDER}") — factual attribution, not blame
- Names in quoted primary sources — evidence, not our framing

**Fix pattern**: Replace personal blame with system/process language. "{TEAM_MEMBER} was the only person who could operate the pipeline" → "Pipeline operations had a single-operator dependency." Focus on what allowed the failure, not who.

#### Rule 7 — Source claims to primary artifacts

> Source claims must trace to primary artifacts (VTT, the incident tracker, code, chat). Flag anything that presents analysis as findings.

**Scan for**:
- Factual claims without source citations or `<!-- Source: ... -->` comments
- Definitive statements about what happened without referencing a primary artifact
- "We learned that..." / "Investigation revealed..." without pointing to where

**Exceptions**:
- Well-known facts that don't need citation ("Azure Functions supports .NET 8")
- Self-evident technical descriptions ("The pipeline uses OFFSET pagination")

**Fix pattern**: Add `<!-- Source: [artifact] -->` comments or inline citations. "Investigation revealed the root cause at 11:00 AM" → "Investigation revealed the root cause at ~11:00 AM (incident-call-analysis.md:25, {TEAM_MEMBER} at 00:23:22 recording time)."

#### Rule 8 — Blameless but factual, never adversarial

> Framing should be blameless-but-factual, never adversarial. Watch for accusatory language.

**Scan for**:
- "their fault", "they should have", "they failed to"
- "inexcusable", "negligent", "incompetent", "reckless"
- Adversarial framing toward other teams: "the upstream team's failure", "the upstream team broke..."
- Passive-aggressive constructions: "despite being informed", "even though they were told"

**Exceptions**:
- Factual descriptions of process gaps are fine: "No handoff procedure existed" is blameless. "Nobody bothered to hand off" is adversarial.
- Quoted text from primary sources — flag only if our framing around the quote is adversarial.

**Fix pattern**: Reframe as system observations. "The upstream team failed to notify us" → "Our team was not on the notification path for the upstream team's data quality issues." Use blameless post-mortem framing: system observations, not personal or team blame.

#### Rule 9 — No speculation as conclusions

> No speculation presented as conclusions. If inference, label it explicitly.

**Scan for**:
- Definitive causal language without evidence: "this caused", "the reason was", "because of" when the causal chain hasn't been verified
- Missing hedging on inferred conclusions: "likely", "appears to", "we believe", "investigation suggests"
- Speculation presented in the same voice as confirmed facts

**Exceptions**:
- Root cause analysis sections where the 5 Whys chain is explicitly laid out — the chain itself is the evidence
- Confirmed facts with clear sourcing don't need hedging

**Fix pattern**: Add evidence markers or hedging language. "The expiration caused the outage" → "The expiration triggered null propagation, which caused the outage (confirmed via KQL: 12M RegionCode records in 24h)." If it's truly inference: "We believe the 4h timeout would have caused recovery failure at default settings, based on the pagination analysis."

## Process

### Step 1: Read the Document

Read `$DOCUMENT` in full. Note the document type and infer `$MODE` if not provided.

### Step 2: Identify Protected Regions

Before scanning, identify regions that should NOT be flagged:

- **HTML comments** (`<!-- ... -->`) — source annotations, not audience content
- **Quoted primary sources** — text explicitly marked as quotes from VTT transcripts, chat logs, the incident tracker data, or code. Look for blockquotes (`>`), inline quotes with attribution, or sections labeled "Source:" / "From [person]:"
- **Code blocks** — KQL queries, code snippets, configuration examples
- **Repair item action descriptions** — these describe future work, not coaching instructions

### Step 3: Scan for Violations

Run each applicable rule against the document content, respecting protected regions.

**In `external` mode**: Apply all 9 rules.
**In `internal` mode**: Apply rules 1–3 only (agent names and coaching instructions can still leak if an internal doc gets forwarded).

For each potential violation:
1. Identify the specific text that triggers the rule
2. Note the section or approximate location in the document
3. Check against exceptions for that rule — dismiss if an exception applies
4. Classify as BLOCK (rules 1–5) or WARN (rules 6–9)
5. Generate a specific fix suggestion

### Step 4: Generate Report

## Output

```
## Retro Content Lint: [document name]

**Mode**: external / internal
**Verdict**: CLEAN ✅ | PASS WITH WARNINGS ⚠️ | BLOCKED ❌
**Blocks**: N | **Warnings**: N

---

### Findings

| # | Rule | Severity | Section | Violation | Suggested Fix |
|---|------|----------|---------|-----------|---------------|
| 1 | R2 | BLOCK | § Timeline | "{Agent}'s VTT review" | → "VTT transcript review" |
| 2 | R6 | WARN | § What Didn't Go Well | "{TEAM_MEMBER} is the only person who could operate..." | → "Pipeline operations had a single-operator dependency" |

---

### Summary

[1-2 sentences on overall document health and what needs to happen before distribution]
```

**Verdict definitions**:
- **CLEAN ✅** — zero findings. "Ready for external distribution."
- **PASS WITH WARNINGS ⚠️** — zero BLOCKs, one or more WARNs. "Review warnings before sending. No hard stops."
- **BLOCKED ❌** — one or more BLOCKs. "Do not distribute externally until blocks are resolved."

If zero findings, output:

```
## Retro Content Lint: [document name]

**Mode**: external
**Verdict**: CLEAN ✅
**Blocks**: 0 | **Warnings**: 0

CLEAN — ready for external distribution.
```

## Guardrails

- **Read-only.** Never modify the target document. Report findings only.
- **Don't over-flag.** A false positive wastes more trust than a missed warning. When in doubt, check the exceptions list for that rule.
- **Don't flag technical terms that contain names.** "Craig's Law", "{TEAM_MEMBER}'s algorithm", "{STAKEHOLDER} Plan" — these are proper nouns, not blame.
- **Don't flag quoted primary evidence.** A VTT quote saying "Sam confirmed it's separate" is evidence being preserved, not our framing. Flag only if the *surrounding narrative* violates a rule.
- **Respect HTML source comments.** `<!-- Source: ... -->` annotations are provenance markers for fact-checking. They are not audience-facing content and should never be flagged under any rule.
- **Internal vs external is a spectrum.** When the user says "this is for the the incident tracker form" — that's external. When they say "this is my working notes" — that's internal. Ask if unclear.
- **Deduplicate overlapping findings.** A single text span should produce at most one finding. If text triggers both R6 (personal blame) and R8 (adversarial framing), prefer R6 when the issue is person-directed blame and R8 when the issue is team/org-level adversarial tone. Only report both if the violations are meaningfully distinct.

## Examples

### Example 1: Document with Violations (External Mode)

**Input**: `initiatives/{INCIDENT_NAME}-sev2-retro/incident-retro-draft.md` in `external` mode

```
## Retro Content Lint: incident-retro-draft.md

**Mode**: external
**Verdict**: PASS WITH WARNINGS ⚠️
**Blocks**: 0 | **Warnings**: 1

---

### Findings

| # | Rule | Severity | Section | Violation | Suggested Fix |
|---|------|----------|---------|-----------|---------------|
| 1 | R6 | WARN | § What Didn't Go Well | "Single operator dependency" names {TEAM_MEMBER} by implication in a gap context | Acceptable — names the role gap, not personal blame. Borderline; review framing. |

### Dismissed

- R4 check: "{TEAM_MEMBER} confirmed disabled" appears only inside `<!-- Source -->` HTML comments — not audience-facing. No action.
- R5 check: "The upstream team reported approximately 50,000... downstream user impact has not been independently quantified" — upstream vs downstream already properly separated. No action.

*Note: HTML `<!-- Source: ... -->` comments throughout the document are provenance annotations and were excluded from scanning.*

---

### Summary

Document is well-structured with clear upstream/downstream separation and sourced claims. No hard blocks. One borderline warning worth reviewing. Ready for external distribution after review.
```

### Example 2: Document with Hard Blocks

**Input**: A hypothetical draft containing common mistakes

Suppose a document contains:

> "The on-call engineer was unavailable when the incident hit, so nobody was managing comms. {Agent} identified the root cause at 11 AM. Make sure to verify the group count before sending this to your skip-level manager. {TEAM_MEMBER} ran the recovery pipeline. About 50,000 users were impacted across the board."

```
## Retro Content Lint: draft-retro.md

**Mode**: external
**Verdict**: BLOCKED ❌
**Blocks**: 5 | **Warnings**: 0

---

### Findings

| # | Rule | Severity | Section | Violation | Suggested Fix |
|---|------|----------|---------|-----------|---------------|
| 1 | R1 | BLOCK | ¶1 | "The on-call engineer was unavailable when the incident hit" — personal leave status in RCA content | → "No backup IM was designated when the primary IM was unavailable" |
| 2 | R2 | BLOCK | ¶1 | "{Agent} identified the root cause" — agent name in external document | → "Codebase investigation identified the root cause" or use the human operator's name |
| 3 | R3 | BLOCK | ¶1 | "Make sure to verify the group count before sending this to your skip-level manager" — coaching instruction mixed with deliverable content | → Remove entirely (execute the instruction, then delete it) |
| 4 | R4 | BLOCK | ¶1 | "{TEAM_MEMBER} ran the recovery pipeline" — nickname in formal document | → "{TEAM_MEMBER} ran the recovery pipeline" |
| 5 | R5 | BLOCK | ¶1 | "About 50,000 users were impacted across the board" — unseparated impact number, no upstream/downstream distinction | → "The upstream team reported ~50,000 active users with nulled attributes upstream. Downstream-confirmed impact: [N groups / N users]." |

---

### Summary

Five hard blocks. This document cannot go external in its current state. All five are straightforward fixes — remove the availability reference, replace agent/nickname with real names, delete the coaching instruction, and separate the impact numbers. Fix and re-run.
```

### Example 3: Clean Internal Document

**Input**: `initiatives/{INCIDENT_NAME}-sev2-retro/incident-call-analysis.md` in `internal` mode

```
## Retro Content Lint: incident-call-analysis.md

**Mode**: internal
**Verdict**: CLEAN ✅
**Blocks**: 0 | **Warnings**: 0

CLEAN — no violations found under internal-mode rules (1–3). This is a working analysis document; rules 4–9 are not applied in internal mode.
```
