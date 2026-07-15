---
name: analyze
description: Run a read-only consistency and quality audit across initiative artifacts (spec, tasks, plan). Use when asked to "analyze", "check consistency", "review the spec", "quality gate", "run analysis", or "check for problems".
---

# Initiative Artifact Analyzer

Read-only cross-artifact consistency engine. Builds semantic models of an initiative's spec, plan, and tasks, then runs six detection passes to surface problems. Never modifies files — reports findings and offers to suggest fixes.

## Inputs

| Parameter | Required | Description |
|-----------|----------|-------------|
| `$INITIATIVE` | Yes | Initiative slug. Maps to `initiatives/[slug]/` |
| `$FOCUS` | No | Limit to specific detection passes (e.g., "coverage only", "SOUL alignment only"). Pass D always runs regardless. |

## Phase 1: Load Artifacts

1. Locate `initiatives/[slug]/spec.md` — **REQUIRED**. Abort with clear error if missing.
2. Locate `initiatives/[slug]/tasks.md` — needed for Pass E. If missing, skip Pass E and note it.
3. Locate `initiatives/[slug]/plan.md` — optional. If present, include in consistency checks.
4. Load `SOUL.md` as the constitution (non-negotiable).
5. Check `domains/` and `expertise/` for terminology definitions to reduce false "terminology drift" findings.

## Phase 2: Build Semantic Models

Do NOT include raw artifact text in subsequent reasoning. Build internal models only:

| Model | Source | Contents |
|-------|--------|----------|
| Requirements inventory | spec.md | Each FR-###, SC-###, NFR-### with descriptive slug |
| User story inventory | spec.md | Each US-## with acceptance criteria |
| Entity inventory | spec.md | Each DM-### with attributes |
| Task coverage map | tasks.md | Each T### → which FR/SC/NFR it implements (infer by keyword/ID reference) |
| SOUL rule set | SOUL.md | Extracted MUST/SHOULD principles |
| Plan inventory | plan.md | Key decisions, architectural constraints, and deferred scope (if present) |

## Phase 3: Six Detection Passes

Run in order. Use the pass definitions below.

| Pass | Label | What it catches |
|------|-------|-----------------|
| A | Duplication | Near-duplicate requirements; flag the lower-quality phrasing |
| B | Ambiguity | Vague adjectives without metrics, unresolved `TBD`/`TBC`/`TODO`/`TKTK`/`[NEEDS CLARIFICATION]` placeholders. Cite the ambiguity category when clear. |
| C | Underspecification | Verbs without objects, stories missing acceptance criteria, tasks referencing undefined components |
| D | SOUL Alignment | Any requirement, plan element, or task that conflicts with a SOUL.md principle. **Always runs. Never skipped.** |
| E | Coverage Gaps | Requirements (FR/SC/NFR) with zero tasks; tasks with no mapped requirement. **Skip if tasks.md missing.** |
| F | Inconsistency | Terminology drift between artifacts, data entities in one artifact but absent in another, contradictory requirements |

If `$FOCUS` is provided, run only the specified passes — but Pass D always runs regardless.

## Phase 4: Assign Severity

Use these severity criteria.

| Level | Criteria |
|-------|----------|
| CRITICAL | SOUL.md violation; missing required artifact; blocking requirement with zero coverage |
| HIGH | Requirement conflict; ambiguous security/performance requirement; missing acceptance criteria on user-facing feature |
| MEDIUM | Terminology drift; missing NFR tasks; uncovered edge case with known workaround |
| LOW | Wording improvement; minor redundancy; non-blocking inconsistency |

**Escalation rule**: When in doubt, escalate. MEDIUM touching auth/data/privacy → HIGH. HIGH touching SOUL.md → CRITICAL.

## Phase 5: Report

Output a structured markdown report inline. Do NOT write to a file.

```
## Analysis Report: [initiative slug]

### Findings

| ID | Pass | Severity | Location(s) | Summary | Recommendation |
|----|------|----------|-------------|---------|----------------|
| CHK001 | B | HIGH | spec.md §NFR-003 | "Fast" has no numeric threshold | Define response time target |
| CHK002 | D | CRITICAL | spec.md §FR-012 | Conflicts with SOUL privacy principle | Remove or redesign feature |

### Coverage Summary

| Requirement | Has Task? | Task IDs | Notes |
|-------------|-----------|----------|-------|
| FR-001 | ✅ | T021, T022 | |
| SC-002 | ❌ | — | No implementation path |

### Metrics
- Total requirements: N
- Total tasks: N
- Coverage: N%
- Ambiguity count: N
- Critical issues: N
- SOUL violations: N

### Next Actions
- [Specific suggested actions based on findings]
```

Cap at 50 findings. If overflow, aggregate remaining in a summary line.

**Optional: Persist Findings**
If the user requests it, or if CRITICAL findings exist, write the findings table to `initiatives/[slug]/checklists/[YYYY-MM-DD]-analysis.md`. Use CHK### IDs (append-only — if a prior analysis file exists, continue numbering from the last CHK ID). This creates a persistent audit trail.

## Phase 6: Remediation Offer

After reporting, offer: "Would you like concrete fix suggestions for the top N issues?"

Do NOT apply fixes automatically. This skill is read-only.

**Finding-to-skill routing:**
- Pass B (ambiguity) / Pass C (underspecification) findings → suggest `clarify` skill
- Pass E (coverage gaps) → suggest `implementation-planner` agent
- Pass D (SOUL violations) → must resolve before any downstream work; surface explicitly
- Pass A (duplication) / Pass F (inconsistency) → suggest re-invoking `specify` or manual spec edit

**Iteration limit**: Max 3 analyze→fix cycles per initiative. If findings persist after 3 iterations, document remaining issues as accepted risk and proceed.

## Rules

- **Strictly read-only.** Never modify any files. Report findings only.
- SOUL.md conflicts are always CRITICAL — no dilution, no reinterpretation, no deferral.
- Pass D (SOUL alignment) always runs, even when `$FOCUS` restricts other passes.
- Cap at 50 findings; aggregate overflow in summary.
- If zero issues found, emit a success report with coverage statistics — not silence.
- Rerunning without changes should produce consistent finding IDs and counts.
- Max 3 analyze→fix cycles per initiative. After 3, document as accepted risk.
- If `tasks.md` is missing, skip Pass E and note it — don't abort the entire analysis.
- Finding IDs use CHK### format (not AN-###) per the foundation ID conventions.
