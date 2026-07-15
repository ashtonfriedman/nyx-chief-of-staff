---
name: source-audit
description: Classify every claim in a document as Sourced, Inferred, Unverifiable, Composite, or Conflicted — epistemic provenance auditing for retros, incident reports, and briefings before external distribution. Use when asked to "audit sources", "check sourcing", "source-audit this document", "classify claims", or before submitting any evidence-based document externally.
---

# Source Audit

Epistemic quality gate for completed documents. Decomposes content into atomic claims, classifies each by provenance, and surfaces what is sourced fact vs. agent inference vs. conflicting evidence — so the operator knows exactly what they're publishing.

**Adjacent skill**: `fact-check` answers "is this true?" — `source-audit` answers "what kind of claim is this?" Run source-audit first to classify, then fact-check to verify high-risk sourced claims.

## When to Invoke

- Document is a completed or near-completed draft going external (the incident tracker retro, leadership briefing, cross-team communication)
- Document contains claims that will justify decisions (repair items, architectural changes, process updates)
- Document contains current-state assertions about live systems (the incident tracker status, ADO state, pipeline health)
- User asks to "audit sources", "check sourcing", "source-audit", "classify claims", "what's sourced vs inferred"
- Before copy-pasting synthesized analysis into the incident tracker fields or external wikis

## When NOT to Invoke

- Working drafts explicitly labeled as in-progress or scratch
- Raw API passthrough with no synthesis (KQL results table, the incident tracker dump) — that's `fact-check` territory
- Internal planning content (task lists, brainstorming, agendas)
- Documents where all claims already have `<!-- Source: -->` annotations and user just wants them verified — use `fact-check`
- Skill files, rule files, agent instructions — normative, not factual
- Operator says "this is internal only and won't be cited"

## Skill Boundaries

| Skill | Domain | Relationship |
|-------|--------|-------------|
| `source-audit` | Epistemic classification — what kind of claim is this? | Runs first on complete drafts |
| `fact-check` | Factual verification — is the cited source actually correct? | Runs after source-audit on high-risk claims |
| `retro-content-lint` | Content rule compliance — HR leaks, agent names, blame language | Complementary; both run before external submission |
| `analyze` | Cross-artifact consistency for specs/tasks/plans | Different document types; may compose |
| `clarify` | Resolve ambiguous claims via operator Q&A | Source-audit flags; clarify resolves |
| `reflect` | Capture patterns as durable rules | Run after source-audit if systemic error patterns emerge |

## Inputs

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `$DOCUMENT` | Yes | — | Path to the markdown file to audit |
| `$SOURCES` | No | Auto-discover | Comma-separated primary source paths or the incident tracker IDs. If omitted, run source discovery (see Phase 1) |
| `$MODE` | No | `report-only` | `report-only` (findings table + summary) or `inline` (annotations written to file after approval) |
| `$FOCUS` | No | All | Limit scope: `"inferred only"`, `"timeline section"`, `"unverifiable only"`, `"conflicted only"` |
| `$CONTEXT` | No | — | Intended audience/use (e.g., "going to the incident tracker retro form", "internal briefing for your skip-level manager"). Calibrates severity |

## Claim Taxonomy (5 classifications)

### Classification Matrix

Use a two-axis test for every claim:

| | Axis 2 YES: Full claim asserts more than source literally says | Axis 2 NO: Claim reproduces only what source says |
|---|---|---|
| **Axis 1 YES**: Some component traces to a primary source | **Composite** — sourced data + inferred layer | **Sourced** — directly traceable, no added interpretation |
| **Axis 1 NO**: No component traces to a primary source | **Inferred** — agent reasoning without primary anchor | **Unverifiable** — no source exists or is accessible |

**Fifth state — Conflicted**: When two or more primary sources disagree on the same factual point, classify as `Conflicted` regardless of the matrix result. Cite both sources, explain the conflict, note the default winner per precedence hierarchy, but **the classification stays Conflicted** even when a default resolution exists. The operator decides whether to accept the default or override.

### Sourced

Directly traceable to a specific locator in a primary artifact. Claim reproduces what the source says — no added reasoning.

Required locators by subtype:

| Subtype | Artifact | Locator Format |
|---------|----------|---------------|
| `VTT` | Transcript | filename + timestamp (e.g., `00:23:22 recording time`) |
| `the incident tracker` | Incident data | the incident tracker ID + field name + pull date |
| `Code` | Source code | repo + file path + line range + commit SHA |
| `Chat` | Teams chat | chat ID + sender + message timestamp |
| `ADO` | Work item | item ID + field name + as-of date |
| `Query` | KQL/API result | query text or ref + execution timestamp |
| `Doc` | Wiki/documentation | URL or path + section heading + revision/as-of date |
| `Email` | Email | message ID or subject + date + sender |

**If no specific locator can be produced → reclassify as Inferred or Unverifiable.** A category ("Source: VTT transcript") is not a locator.

### Inferred

Agent's analysis, synthesis, or conclusion drawn from primary artifacts. Not wrong — epistemically different from Sourced.

| Confidence | Definition |
|-----------|-----------|
| `Strong` | Two or more independent primary sources converge |
| `Weak` | Single data point + agent reasoning; alternatives exist |
| `Speculative` | No data point supports; plausible extrapolation |

### Unverifiable

No primary source exists or is accessible.

Categories: `No source exists` (subjective judgment), `Source inaccessible` (deleted, locked), `Future state` (predictions), `Cross-team assertion` (cannot independently verify another team's actions).

### Composite

Sourced data combined with inferred conclusion such that the whole reads as sourced. **Most dangerous type** — partially true, which validates the inference to casual readers.

Markers: "which shows that...", "meaning that...", "confirming that...", derived ratios/percentages, causal attribution ("because of X, Y happened").

Required treatment: Split into sourced component (with locator) and inferred component (with confidence level).

### Conflicted

Two or more primary sources disagree on the same factual point. NOT the same as Inferred — conflicted claims have multiple sources, they just don't agree.

Required treatment: Cite both sources, state the conflict, apply precedence hierarchy to determine default resolution, escalate if material.

## Source Precedence Hierarchy

Default precedence (highest to lowest):

1. **Code/repo** — immutable at a point in time (require commit SHA for time-sensitive claims)
2. **Raw timestamps** — the incident tracker state change events, VTT timestamps, chat message times
3. **Verbatim recordings** — VTT transcript text, chat log text (what was actually said)
4. **the incident tracker structured fields** — severity, state, assignments (human-entered, reliable)
5. **the incident tracker narrative fields** — summaries, root cause descriptions (**may be AI-generated** — always flag provenance, never treat as ground truth without corroboration)
6. **Our analysis** — always lowest, always labeled as such

### Conflict Resolution

- **Same-tier sources disagree** → classify as `Conflicted`, cite both, surface as priority action item
- **Different-tier sources disagree** → classify as `Conflicted`, recommend higher tier as default winner, but operator confirms. The classification is still Conflicted — a default resolution does not remove the conflict.
- **the incident tracker narrative fields vs ANY other source** → classify as `Conflicted`, the other source is the recommended winner; the incident tracker narrative is treated as potentially AI-generated unless corroborated
- **When in doubt** → escalate to operator, don't auto-resolve

### Claim-Type Resolution Defaults

| Claim type | Default winner |
|-----------|---------------|
| Incident timestamps / state / ownership | the incident tracker structured fields |
| Who said what / meeting decisions | VTT/Teams raw record |
| Technical behavior / mechanism | Code, logs, query results |
| Planned actions / tracking | ADO/the incident tracker tracker |
| the incident tracker narrative vs anything | Anything else wins |

## Execution Phases

### Phase 1 — Pre-Check & Source Inventory

**1a. Decision gate** — Apply the invocation tree. If the document doesn't warrant audit, abort with explanation.

**1b. Source discovery** (when `$SOURCES` is omitted):
1. Parse document for references: the incident tracker IDs (`/\d{9,}/`), VTT filenames (`*.vtt`), ADO IDs (`#\d+`), chat refs, URLs, code file paths
2. Glob the initiative directory (parent of `$DOCUMENT`) for `.vtt`, `.md`, `.json` artifacts
3. Check session_store for recent sessions that touched the same initiative directory — extract source refs from those sessions
4. For each referenced source: attempt to read/access it. If inaccessible, flag in report header as `Source inaccessible: [name] — [reason]`
5. If discovery yields nothing for a source referenced in the document, flag as `Source referenced but not found: [ref]`

**1c. Existing annotation scan**:
- Find all `<!-- Source: ... -->` annotations already in the document
- Credit only if they meet locator specificity (subtype + specific locator per the table above)
- Vague annotations like `<!-- Source: VTT transcript -->` (no timestamp) → flag as "insufficient — reclassified as Inferred/Weak pending re-sourcing"
- Properly sourced annotations → skip re-classification for those claims, but still check for stale data and conflicts against other sources

**1d. Stale data scan**:
- Identify all current-state assertions (the incident tracker status, ADO state, pipeline health, metric values)
- Check for pull dates / commit SHAs / as-of timestamps
- Flag immediately if current-state claims lack temporal anchors
- Require commit SHA / revision / as-of timestamp for ALL time-sensitive code, docs, ADO, and wiki claims

### Phase 2 — Claim Extraction

Read the document section by section. Extract every declarative factual assertion.

**Decompose compound claims** into atomic sub-claims. Stopping criterion: each sub-claim isolates a **single verifiable assertion**. An assertion is atomic when it has one subject doing/being one thing at one time. Don't split an actor from their action — "{TEAM_MEMBER} confirmed triggers were off" is atomic (one person, one statement, one fact). DO split when independent facts are joined: "Pipeline was disabled at 11:11 AM and recovery completed at 3:30 AM" → two claims with independent timestamps and sources.

**Do NOT extract**:
- Explicit opinions or recommendations ("we recommend X")
- Questions or existing uncertainty markers ("it is unclear whether...")
- Planning/future-state proposals clearly marked as such
- Definitions or glossary entries

Preserve location context (section heading, paragraph position) for each claim.

### Phase 3 — Classification Pass

For each extracted claim, apply the **two-axis matrix**:

```
Step 1: Can any component be directly traced to a primary source with a specific locator?
        → Record which component, which source, which locator.

Step 2: Does the full claim assert more than the source literally says?
        → Look for added reasoning, interpretation, synthesis, derived numbers.

Step 3: Apply matrix:
        Axis 1 YES + Axis 2 YES → Composite (split into sourced + inferred components)
        Axis 1 YES + Axis 2 NO  → Sourced (record full locator)
        Axis 1 NO  + Axis 2 YES → Inferred (assign confidence: Strong/Weak/Speculative)
        Axis 1 NO  + Axis 2 NO  → Unverifiable (specify category)

Step 4: Conflict check — does any other primary source contradict this claim?
        → YES: override to Conflicted. Cite both sources. Apply precedence hierarchy.
        → NO: keep matrix classification.

Step 5: Stale-data check — is this a current-state assertion?
        → YES: add stale-data flag with source pull date / commit SHA.
```

**Critical guardrails during classification:**
- Agent-generated `.md` files are NOT primary sources — trace back to the Tier 1/2 source they cited
- No fabricated locators (NFR-03) — if you can't produce a specific locator, it's not Sourced
- Approximations (~11:11 AM ET from VTT arithmetic) are Composite, not Sourced
- Derived numbers (ratios, percentages, multiples) are Inferred, not Sourced
- Attribution claims ("{TEAM_MEMBER} confirmed X") are Sourced only if quoting/closely paraphrasing with a locator; interpreting what someone meant is Composite or Inferred

### Phase 4 — Report Generation

#### CRITICAL RULE: Every claim in the output MUST clearly note its source.

Generate findings in the format specified in Output section below.

**Action items list** (ordered by severity):
1. All `Conflicted` claims — priority resolution needed
2. All `Unverifiable` claims — disposition decision required
3. All `Inferred/Speculative` claims — verify or label before external use
4. All `Composite` claims — unconditionally listed; split sourced from inferred in the document
5. All stale-data claims — re-query required

### Phase 5 — Confidence Score

Calculate summary statistics including all 5 classification types (Sourced, Inferred by level, Composite, Conflicted, Unverifiable).

**Severity gate**: Any `Conflicted` claim on a speculative, current-state, or root-cause topic **blocks** `High Confidence` regardless of Sourced percentage.

| Label | Threshold | Blocked by |
|-------|-----------|-----------|
| `High Confidence` | ≥80% Sourced | Any speculative/current-state/root-cause Conflicted claim |
| `Mixed` | 50–79% Sourced | — |
| `Low Confidence` | <50% Sourced | — |

### Phase 6 — Annotation Application (gated, inline mode only)

Present the annotation plan. **Do NOT write to the source file without explicit operator approval** (FR-12).

Annotation formats:
- Sourced: `<!-- Source: [subtype] [locator] -->`
- Inferred: `<!-- ⚠️ INFERRED/[level]: [reasoning]. Verify if going external. -->`
- Unverifiable: `<!-- ❌ UNVERIFIABLE: [reason]. Remove or explicitly mark in document text. -->`
- Composite: `<!-- COMPOSITE — Sourced: [locator]; Inferred/[level]: [reasoning] -->`
- Conflicted: `<!-- ⚡ CONFLICTED: Source A says [X]; Source B says [Y]. Resolution: [default winner per hierarchy]. Escalate if material. -->`
- Stale data: `<!-- ⏰ STALE DATA RISK: source pulled [date/SHA]. Re-query before external use. -->`

If operator requests annotated copy without modifying original → create `[original]-audited.md`.

## Output Format

### Report-Only Mode

```
## Source Audit Report

**Document**: [path]
**Audited**: [timestamp]
**Context**: [audience/use if provided]
**Available sources**: [list of source artifacts used]
**Inaccessible sources**: [list, with reason] (or "None")

---

### Findings

| # | Claim (abbreviated) | Location | Classification | Confidence | Source / Reason |
|---|---------------------|----------|----------------|------------|-----------------|
| 1 | "Pipeline disabled at ~11:11 AM ET" | Timeline §, row 5 | Composite | Strong | VTT 00:58:03 sourced; wall-clock conversion inferred |
| 2 | "~50,000 users affected" | Impact ¶1 | Composite | Weak | Upstream count sourced (the incident tracker INC-1001); downstream impact inferred |
| 3 | "the incident tracker shows MITIGATED" / VTT says RESOLVED | Status ¶1 | Conflicted | — | the incident tracker pull 2026-04-02 vs VTT 00:42:11. Higher tier: raw timestamp wins |
| 4 | "Root cause category: Dependency" | Factors § | Unverifiable | — | the incident tracker taxonomy is human judgment |

---

### Summary

| Classification | Count | % |
|---------------|-------|---|
| Sourced | N | N% |
| Inferred/Strong | N | N% |
| Inferred/Weak | N | N% |
| Inferred/Speculative | N | N% |
| Composite | N | N% |
| Conflicted | N | N% |
| Unverifiable | N | N% |
| **Total claims** | **N** | — |

**Overall confidence**: High / Mixed / Low
[If gated]: "Blocked from High by: [Conflicted claim on root-cause topic]"

---

### Action Items Before External Use

1. ⚡ CONFLICTED (#3): the incident tracker status vs VTT — resolve before publishing.
2. ❌ UNVERIFIABLE (#4): Root cause category requires human selection.
3. ⚠️ INFERRED/Speculative: [claim] — verify or label explicitly.
4. ♻️ COMPOSITE (#2): Separate upstream count from inferred downstream impact.
5. ⏰ STALE DATA: [claims] — source pulled [date]. Re-query before submission.

---

### Recommended Follow-Ups

- Run `fact-check` on [N] Sourced claims with external URLs or ADO IDs.
- Run `retro-content-lint` before external submission.
- Re-query the incident tracker [ID] for current state.
- Review [N] Inferred claims for possible promotion via additional artifact review.
```

### Clean Document (no issues)

```
## Source Audit Report

**Document**: [path]
**Audited**: [timestamp]
**Overall confidence**: High Confidence
**Sourced**: N/N claims (100%)

All claims trace to primary sources with specific locators. Ready for external use.
```

## Rules (Hard Constraints)

1. **Read-only by default.** Never modify the target document without explicit approval.
2. **No fabricated locators.** If you can't produce a specific locator, the claim is NOT Sourced. A fabricated locator is worse than Inferred/Weak because it creates false confidence. (NFR-03)
3. **Agent artifacts are NOT primary sources.** `incident-call-analysis.md`, `retro-prep.md`, any `.md` the agent produced — trace back to Tier 1/2 sources they cited, or classify as Inferred.
4. **Single classification pass.** No iterative analyze→revise→re-analyze loops. One pass, operator reviews, corrections in next invocation. (NFR-07)
5. **Source every claim in output.** Every claim in the findings table MUST clearly note its source. The operator must be able to trace each classification to evidence without requesting explanation. (NFR-02)
6. **Graceful degradation.** If a source is inaccessible, proceed with what's available, flag the gap, don't abort. (NFR-04)
7. **Idempotent annotations.** Don't re-annotate claims that already have proper `<!-- Source: -->` annotations with specific locators. (NFR-05)
8. **Comply with retro content standards.** No personal availability, no agent names, no coaching instructions, real names only in output. (NFR-06)
9. **Temporal anchoring required.** Every time-sensitive claim needs a commit SHA, revision ID, pull date, or as-of timestamp. No undated sources for current-state claims.
10. **the incident tracker narrative fields are suspect.** Always flag provenance of the incident tracker narrative/summary fields — they may be AI-generated. Never treat as ground truth without corroboration.
11. **Absence claims need two search strategies.** A single null result is Inferred/Weak, not Sourced. Document the search paths.
12. **Locator specificity test.** A locator must be specific enough that a human could find the referenced content within 60 seconds. "VTT transcript" fails. "VTT incident-call-part1.vtt 00:23:22" passes.

## Examples

### Example 1: Document with Conflicts and Composites

**Input**: `initiatives/{INCIDENT_NAME}-sev2-retro/retro-prep.md`, report-only mode

```
## Source Audit Report

**Document**: initiatives/{INCIDENT_NAME}-sev2-retro/retro-prep.md
**Audited**: 2026-04-07T14:30:00Z
**Context**: Going to the incident tracker retro form (external)
**Available sources**: the incident tracker INC-1001 (pulled 2026-04-07), incident-call-part1.vtt, incident-call-part2.vtt, Teams chat logs ({DEV_PM_CHAT}), retro-prep.md existing annotations
**Inaccessible sources**: None

---

### Findings

| # | Claim (abbreviated) | Location | Classification | Confidence | Source / Reason |
|---|---------------------|----------|----------------|------------|-----------------|
| 1 | "PROD pipeline triggers disabled at ~11:11 AM ET" | Timeline, row 5 | Composite | Strong | VTT 00:58:03 sourced; the incident tracker creation 10:13 AM sourced; wall-clock sum is arithmetic inference |
| 2 | "~50,000 users affected by this incident" | Impact ¶1 | Composite | Weak | Upstream count sourced (the incident tracker INC-1001 customer-impact field); "by this incident" inferred — downstream impact not independently quantified |
| 3 | "Integration layer failed to read out-of-window records" | Contributing Factors | Inferred | Weak | Single source: incident-call-analysis.md:89 traces to a teammate's hypothesis on the incident call. Mechanism not confirmed via code |
| 4 | "Root cause: Dependency / Upstream Data Quality" | Contributing Factors | Unverifiable | — | the incident tracker taxonomy selection is human judgment, not document fact |
| 5 | "Incident tracker status: MITIGATED" | Status ¶1 | Sourced/incident tracker | — | the incident tracker INC-1001 resolveTime field. ⏰ STALE: pull date 2026-04-02, incident now RESOLVED per fresh pull |
| 6 | "Root cause identified within 30 min" | Timeline | Composite | Strong | VTT 00:23:22 sourced ({TEAM_MEMBER}: "I think I've diagnosed the issue"); "30 min" is arithmetic derivation from bridge start time — inferred component |
| 7 | Existing annotation: `<!-- Source: VTT transcript -->` on ¶3 claim | Timeline | Inferred/Weak | — | Annotation insufficient — no timestamp. Reclassified pending re-sourcing |

---

### Summary

| Classification | Count | % |
|---------------|-------|---|
| Sourced | 12 | 48% |
| Inferred/Strong | 3 | 12% |
| Inferred/Weak | 5 | 20% |
| Inferred/Speculative | 1 | 4% |
| Composite | 3 | 12% |
| Conflicted | 0 | 0% |
| Unverifiable | 1 | 4% |
| **Total claims** | **25** | — |

**Overall confidence**: Mixed (48% Sourced)

---

### Action Items Before External Use

1. ⏰ STALE DATA (#5): Incident tracker status is 5 days stale — MITIGATED vs RESOLVED. Re-query before submission.
2. ❌ UNVERIFIABLE (#4): Root cause category requires human selection from the incident tracker taxonomy — mark as "suggested" or remove.
3. ⚠️ INFERRED/Weak (#3): "Out-of-window records" is one engineer's hypothesis. Verify via code or label: "under investigation."
4. ♻️ COMPOSITE (#2): Separate upstream count (~50,000) from downstream impact (unquantified).
5. ♻️ COMPOSITE (#1): Wall-clock time (~11:11 AM) is arithmetic from VTT + the incident tracker — note the derivation.
6. ⚠️ INSUFFICIENT ANNOTATION (#7): `<!-- Source: VTT transcript -->` lacks timestamp — re-source with specific locator.

---

### Recommended Follow-Ups

- Re-query the incident tracker INC-1001 for current state before filing retro.
- Run `fact-check` on ADO item IDs and any external URLs.
- Run `retro-content-lint` before external submission.
```

### Example 2: Clean, Well-Sourced Document

**Input**: A timeline document where every entry has specific VTT/the incident tracker locators.

```
## Source Audit Report

**Document**: initiatives/{INCIDENT_NAME}-sev2-retro/sourced-timeline.md
**Audited**: 2026-04-07T15:00:00Z
**Available sources**: the incident tracker INC-1001 (pulled 2026-04-07 this session), incident-call-part1.vtt, incident-call-part2.vtt
**Inaccessible sources**: None

---

### Summary

| Classification | Count | % |
|---------------|-------|---|
| Sourced | 18 | 90% |
| Composite | 2 | 10% |
| **Total claims** | **20** | — |

**Overall confidence**: High Confidence

18 claims directly sourced with specific locators. Two Composite claims are arithmetic derivations (VTT timestamp → wall-clock time) — sourced inputs with inferred arithmetic, verifiable math. No action items beyond noting the derivations.

---

### Recommended Follow-Ups

- Run `retro-content-lint` before external submission (content rules, not sourcing).
```

### Example 3: Document with Source Conflicts

**Input**: A briefing where the incident tracker narrative contradicts VTT evidence.

```
## Source Audit Report

**Document**: initiatives/{INCIDENT_NAME}-sev2-retro/leadership-briefing.md
**Audited**: 2026-04-08T09:00:00Z
**Context**: Briefing for your skip-level manager (internal, but will be cited in decisions)
**Available sources**: the incident tracker INC-1001 (pulled 2026-04-08), incident-call-part1.vtt

---

### Findings

| # | Claim (abbreviated) | Location | Classification | Confidence | Source / Reason |
|---|---------------------|----------|----------------|------------|-----------------|
| 1 | "Incident detected at 10:00 AM" (the incident tracker summary) vs "the incident tracker created at 10:13 AM" (the incident tracker creation timestamp) | Timeline ¶1 | Conflicted | — | the incident tracker narrative says 10:00 AM detection; the incident tracker creation timestamp says 10:13 AM. Same event, different times. Default winner: raw timestamp (tier 2) over the incident tracker narrative (tier 5). the incident tracker narrative may be AI-generated. |
| 2 | "Root cause was expired credentials" (the incident tracker summary) vs "Root cause was upstream data quality" (VTT, {TEAM_MEMBER} at 00:23:22) | Root Cause § | Conflicted | — | the incident tracker narrative field vs VTT verbatim. Per hierarchy: VTT (tier 3) wins over the incident tracker narrative (tier 5). Escalate — root-cause conflict is material. |

---

### Summary

| Classification | Count | % |
|---------------|-------|---|
| Sourced | 8 | 62% |
| Conflicted | 2 | 15% |
| Inferred/Strong | 3 | 23% |
| **Total claims** | **13** | — |

**Overall confidence**: Mixed (62% Sourced)
Blocked from High by: Conflicted claim on root-cause topic (#2).

---

### Action Items Before External Use

1. ⚡ CONFLICTED (#2): Root cause conflict between the incident tracker narrative and VTT evidence — MUST resolve before briefing. VTT wins by default; verify the incident tracker narrative provenance (may be AI-generated summary).
2. ⚡ CONFLICTED (#1): Detection time conflict — default winner is the incident tracker creation timestamp (10:13 AM) over the incident tracker narrative (10:00 AM). Confirm with operator.
```

## Edge Case Reference

| Scenario | Classification | Rationale |
|----------|---------------|-----------|
| VTT timestamp → wall-clock time | Composite | Raw timestamp sourced; arithmetic conversion inferred |
| Derived ratio ("15× amplification") | Inferred/Strong | Inputs may be sourced; calculation is agent work |
| "{TEAM_MEMBER} confirmed X" (close paraphrase + locator) | Sourced/VTT | Locator present, reproduces what was said |
| "{TEAM_MEMBER} agreed with the diagnosis" (interpretation) | Composite or Inferred | Interpretive layer added to raw quote |
| "No runbook existed" (single null search) | Inferred/Weak | Need 2+ search strategies for Sourced absence |
| "Upstream team's on-call downgraded the the incident tracker" (cross-team action) | Sourced/VTT + Unverifiable/Cross-team | "the teammate said it" is sourced; "did the upstream team actually do it?" is unverifiable |
| the incident tracker summary/narrative field | Sourced/incident tracker with **mandatory provenance warning** | May be AI-generated — classify as Sourced only for "the incident tracker narrative says X", never for "X is true because the incident tracker says so". Any contradiction from another source → Conflicted, other source wins |
| Agent-generated `.md` cited as source | Trace to Tier 1/2 | If chain breaks → Inferred |
| Existing `<!-- Source: VTT transcript -->` (no timestamp) | Insufficient | Reclassify as Inferred/Weak pending re-sourcing |

## Decision Tree

```
Is the document a completed or near-completed draft?
├── NO → Don't invoke. Source-audit is a quality gate, not a drafting aid.
└── YES
    ├── Going external, or used as evidence for decisions? → INVOKE
    ├── Contains current-state assertions about live systems? → INVOKE (stale-data check at minimum)
    ├── Purely internal planning content? → Don't invoke
    ├── Raw API passthrough with no synthesis? → Don't invoke (fact-check instead)
    └── Contains synthesized claims not covered above? → INVOKE
```
