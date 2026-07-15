---
name: retro-prep
description: Prepare for incident retrospective meetings by refreshing the incident tracker data, building evidence-backed timelines, analyzing stakeholders, and generating talking points with anticipated Q&A. Use when asked to "prep for a retro", "prepare for postmortem", "get ready for incident review", "retro prep for [incident]", or when a calendar event matching retro/postmortem/incident-review is upcoming.
---

# Retro Prep Skill

## Purpose

Given an incident and an upcoming retrospective meeting, produce a structured prep package grounded in fresh evidence. Pulls from the incident tracker, VTT transcripts, Teams chats, code commits, and initiative artifacts to build a timeline, stakeholder analysis, talking points, anticipated questions, and cross-team asks.

This extends the pattern from `meeting-prep` but is a standalone skill — it does not depend on running `meeting-prep` first. Where `meeting-prep` optimizes for broad context gathering, `retro-prep` optimizes for **evidence handling, conflict detection, and blameless-but-factual preparation**.

**Origin**: Built from the {INCIDENT_NAME} Sev 2 retro prep (Day 6), where all of this work was done ad hoc under time pressure. Next incident retro shouldn't start from scratch.

## Triggering

This skill can be invoked:
- **Explicitly**: "prep for a retro", "prepare for postmortem", "retro prep for [incident]", "get ready for incident review"
- **From calendar**: When an upcoming event subject matches `retro`, `postmortem`, `incident review`, `RCA review`, or `post-incident`
- **From initiative context**: When working in an initiative directory that contains incident artifacts and a retro meeting is approaching

## Required Configuration

Same as `meeting-prep`:
- `## Azure DevOps Defaults` — org, project, area path
- `## Teams Channels` — for team channel message searches
- `## VIP Contacts` — for identifying key stakeholders in attendee lists

Additionally needs:
- Access to the incident tracker portal API (or manual the incident tracker data input if API unavailable)
- Initiative directory with existing incident artifacts

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| Initiative path | **Yes** | e.g., `initiatives/{INCIDENT_NAME}-sev2-retro/` — where existing artifacts live |
| Meeting details | **Yes** | Calendar event ID, or manual: time, attendees, agenda |
| the incident tracker incident ID | Recommended | For fresh data pull. If omitted, proceed in degraded mode (see below) |

If the user provides just an incident name, search `initiatives/` for the matching directory.

## Execution Phases

### Phase 1: Source Refresh + Validation

**Goal**: Ensure every data source is fresh before any synthesis begins.

#### 1a. Refresh the incident tracker Data

> **Rule** (from `.working-memory/rules.md`): *the incident tracker data goes stale. Re-pull incident state from the API before finalizing any retro or report. Don't trust snapshots older than the current session.*

- Pull current incident state from the incident tracker API
- Compare to any existing analysis in the initiative directory
- **Flag every discrepancy** between cached and live data (state changes, severity updates, resolution details, new linked incidents)
- If the incident tracker is unavailable → enter **Degraded Mode** (see Degraded Mode section below)

#### 1b. Inventory Available Sources

Before synthesizing anything, catalog what exists:

| Source | Status | Freshness | Location |
|--------|--------|-----------|----------|
| the incident tracker incident data | ✅ Fresh / ⚠️ Stale / ❌ Missing | {timestamp} | {link or path} |
| VTT transcripts | ✅ / ❌ | {date} | {path} |
| Incident call analysis | ✅ / ❌ | {date} | {path} |
| Teams chat logs | ✅ / ❌ | {date range} | {chat IDs} |
| Code commits | ✅ / ❌ | {date range} | {repo} |
| Prior analysis docs | ✅ / ❌ | {date} | {paths} |

This inventory goes into the output so readers know what the prep is built from.

#### 1c. Detect Source Conflicts

Scan across sources for contradictions:
- Timestamps that disagree across sources
- Impact numbers that differ (upstream vs downstream counts)
- State descriptions that conflict (one source says MITIGATED, another says RESOLVED)

Log conflicts for explicit surfacing in Phase 3.

### Phase 2: Evidence Inventory + Freshness Assessment

#### 2a. Confidence Labels

Every factual claim in the output must carry a confidence label:

| Label | Meaning | When to Use |
|-------|---------|-------------|
| `confirmed` | Verified by primary source or multiple corroborating sources | Timestamps from logs, impact numbers from queries |
| `conflicted` | Sources disagree — present both versions | the incident tracker says X, transcript says Y |
| `inferred` | Derived from artifacts but not directly stated | Room dynamics from attendee list, causation from correlation |
| `missing` | We know this gap exists but have no data | Timeline periods with no source coverage |

> **Rule** (from `.working-memory/rules.md`): *Artifacts ≠ experience. Transcripts, timestamps, and chat logs are partial records, not ground truth. Flag interpretations as interpretations — not conclusions.*

#### 2b. Source Precedence

When sources conflict, default precedence (can be overridden with justification):

1. **the incident tracker API** (current pull) — authoritative for incident state, severity, timeline milestones
2. **System logs / KQL queries** — authoritative for impact numbers, event counts, timestamps
3. **VTT transcripts** — strong evidence for decisions, reasoning, who said what (but timestamps may drift)
4. **Teams chat logs** — strong for real-time coordination context
5. **Code commits** — supporting evidence only; commit time ≠ incident event time unless explicitly linked
6. **Prior analysis docs** — treat as interpretations, not primary sources; validate against fresh data

### Phase 3: Timeline Synthesis

Build the incident timeline from all available sources.

- **Normalize to one canonical timezone** (use the timezone from the retro meeting invite, or ET if unspecified). Preserve raw timestamps in parentheses where they differ.
- **Source every entry** — each timeline event gets a source tag: `[the incident tracker]`, `[VTT]`, `[Chat]`, `[Commit]`, `[KQL]`
- **Flag gaps** — periods where no source provides coverage get a `[GAP]` marker with the time range
- **Flag conflicts** — where sources disagree on timing, present both with `[CONFLICTED]` marker
- **Separate observed events from inferred causation** — "Pipeline disabled at 11:11 AM [the incident tracker]" is observed. "Disabling the pipeline prevented further data corruption" is inferred.

Compare the fresh timeline against any existing timeline in the initiative directory. Call out material changes.

### Phase 4: Meeting Prep Outputs

#### 4a. Stakeholder Analysis

Map every attendee from the meeting invite:

| Name | Team | Role in Incident | Likely Concerns | Notes |
|------|------|-----------------|-----------------|-------|
| {name} | {team} | {role} | {what they care about} | {decision-maker, technical lead, etc.} |

- **Identify team composition** — how many from each team. Note where our team is a minority.
- **Map decision-makers** — who has authority to approve repair items, assign action items, set follow-ups
- **Flag unknowns** — attendees whose team affiliation or role is unclear → research before the meeting
- **Note potential allies** — people whose interests align on specific agenda items

> This section is **internal prep only** — it should never appear in shared retro materials. See Output Contracts.

#### 4b. Talking Points (per agenda item)

For each agenda item (from the meeting invite or known agenda):

```markdown
### Agenda Item: {title}

**Key Facts** (sourced):
- {fact} [source] [confidence: confirmed/conflicted/inferred]
- {fact} [source] [confidence]

**Our Position**:
- {factual, not defensive statement}
- {supported by evidence above}

**Supporting Evidence**:
- {document or data point with path/link}

**Vulnerabilities** (what we should acknowledge):
- {genuine weakness or gap — don't hide these, prepare for them}
```

Generate topic-specific supplementary docs if an agenda item requires detailed technical explanation (e.g., data flow diagrams, architecture explainers). These go in the initiative directory.

#### 4c. Anticipated Questions

> Not "defensive Q&A" — this is preparation, not argumentation.

| Question / Challenge | Factual Response | Evidence | Our Genuine Vulnerability |
|----------------------|-----------------|----------|--------------------------|
| {What might they ask?} | {Factual answer} | {Source reference} | {Where are we actually exposed?} |

Guidelines:
- Anticipate hard questions, not just easy ones
- Where we're genuinely at fault, prepare an honest acknowledgment + what we're doing about it
- Frame responses as system analysis, never personal defense
- "We don't name names in retros. We name events."

#### 4d. Cross-Team Asks

If this is a cross-team retrospective, generate constructive requests:

```markdown
### {Ask Title}

**The ask**: {What we need}
**Why**: {System-level justification — not blame}
**Concrete**: {Specific measurable action}
```

Guidelines:
- Frame as system improvements, not blame
- Each ask should have a clear "what" and "why"
- If they push back, have a fallback position ready
- Don't demand timelines in the retro — get agreement on the ask, timelines come from repair item tracking

#### 4e. Open Questions

Unknowns that could come up in the meeting:

- [ ] {Question we can't answer yet} — {why it matters}
- [ ] {Data we're missing} — {where to get it}
- [ ] {Assumption we're making} — {what would change if wrong}

#### 4f. Action Item Mapping

Categorize repair items from existing analysis:

| Category | Items |
|----------|-------|
| **Our repair items** | Internal fixes we own |
| **Cross-team asks** | What we need from other teams |
| **Unresolved investigation** | Items needing more data before action |
| **Process changes** | Non-technical improvements |

### Phase 5: Lint + Final Verification

#### 5a. Content Lint

If `retro-content-lint` skill is available, run it against all output documents. Otherwise, manually verify:

- [ ] No personal info (availability, leave status, personal circumstances)
- [ ] No agent names — use real names or team attribution only
- [ ] No nicknames — formal names in formal documents
- [ ] No coaching instructions mixed with deliverable content
- [ ] Upstream vs downstream impact numbers are clearly separated
- [ ] Every factual claim has a source reference
- [ ] Inferences are explicitly marked as inferences
- [ ] Blameless framing throughout — events, not names
- [ ] the incident tracker data is fresh (pulled this session, not cached)

These checks come from `.working-memory/rules.md` lines 99-105.

#### 5b. Completeness Check

- [ ] Source inventory table is populated
- [ ] Timeline has no unacknowledged gaps
- [ ] Every attendee is mapped (or flagged as unknown)
- [ ] Every agenda item has talking points
- [ ] Anticipated questions cover hard questions, not just soft ones
- [ ] Open questions are genuine unknowns, not rhetorical

#### 5c. Final Read-Through

Re-read the entire prep package from the perspective of someone walking into the meeting. Ask:
- Would this prep make me confident walking in?
- Are there any surprises that could catch us off guard?
- Is the tone blameless-but-factual, or has it drifted toward adversarial?

## Output Contracts

### Required Output

**`retro-prep.md`** — main prep document in the initiative directory:
- Source inventory (what this prep is built from)
- Executive summary
- Timeline (sourced, normalized, gaps flagged)
- Talking points per agenda item
- Anticipated questions table
- Open questions
- Action item mapping
- Artifacts list

### Conditional Output

**`cross-team-asks.md`** — only if this is a cross-team retrospective:
- Numbered asks with ask/why/concrete structure
- Framing notes for delivery

**Topic-specific docs** (e.g., `consumer-logic-talking-points.md`) — only if agenda items require detailed technical explanation beyond what fits in talking points.

### Internal-Only vs Share-Safe

| Document | Classification | Rationale |
|----------|---------------|-----------|
| `retro-prep.md` (full) | **Internal only** | Contains stakeholder analysis, vulnerability mapping, anticipated challenges |
| Timeline section | **Share-safe** | Factual, sourced, blameless |
| Cross-team asks | **Share-safe** (after review) | Constructive framing, meant to be presented |
| Topic-specific docs | **Share-safe** (after review) | Technical explainers for the room |
| Stakeholder analysis | **Internal only — NEVER share** | Team composition, power dynamics, ally mapping |
| Anticipated questions | **Internal only** | Preparation framing not meant for the room |

## Degraded Mode

When the incident tracker data is unavailable (API down, no incident ID, access issues):

1. **Add a prominent banner** to all output:
   ```
   ⚠️ DEGRADED MODE — the incident tracker data not available. This prep is built from cached/local artifacts only.
   Verify incident state independently before the meeting.
   ```
2. **Timeline is tentative** — mark the entire timeline as `[TENTATIVE]`
3. **No authoritative position statements** — talking points should be framed as "based on available artifacts" not "the facts are"
4. **No rebuttal assertions in anticipated questions** — only state what evidence supports, don't claim certainty
5. **Flag in open questions** — add "the incident tracker state unverified" as the first open question

## Guardrails

- **ALWAYS re-pull the incident tracker data** — never trust cached state, even if it was pulled earlier today
- **Artifacts ≠ experience** — flag all inferences explicitly. If you weren't in the room, don't write like you were
- **No personal info** in prep docs — no availability, no leave status, no personal circumstances
- **Blameless-but-factual** — "The pipeline processed what its source of truth sent" not "Team X broke the data"
- **"We don't name names in retros. We name events"** — describe code paths, system behaviors, process gaps
- **Separate upstream and downstream impact** — never conflate another team's blast radius with our confirmed impact
- **Source everything** — unsourced claims don't belong in retro prep
- **Internal prep stays internal** — stakeholder analysis and anticipated questions are never shared externally

## References

- Incident-response practices — investigation templates, post-mortem format, 5 Whys, blameless process guidance
- `.working-memory/rules.md` — retro content rules (lines 99-105), artifacts ≠ experience (line 81), the incident tracker staleness (line 82)
- `.github/skills/meeting-prep/SKILL.md` — general meeting prep pattern (this skill borrows structure but is standalone)

## Example: {INCIDENT_NAME} Sev 2 Retro Prep (Day 6)

This skill was born from the {INCIDENT_NAME} Sev 2 retrospective preparation. Here's what the process looked like and what the output contained:

### What We Had Going In

- Initiative directory: `initiatives/{INCIDENT_NAME}-sev2-retro/`
- Incident call VTT transcripts (Parts 1 and 2, analyzed into `incident-call-analysis.md` and `incident-call-analysis-part2.md`)
- the incident tracker incident data (but discovered it was 5 days stale — MITIGATED vs RESOLVED)
- Teams chat logs from the the incident tracker bridge, plus individual chats with {TEAM_MEMBER}, {TEAM_MEMBER}
- Recovery options doc from the incident itself
- Calendar invite with attendee list showing cross-team composition

### What We Produced

**`retro-prep.md`** (main prep document):
- Executive summary of the incident (upstream RegionCode data loss)
- Full timeline from ~Day 1 through recovery at ~03:30 on Day 2
- 5 Whys root cause analysis (unconditional trust in upstream dependency)
- Impact tables: upstream (upstream-reported ~50,000) vs downstream (40 groups, 3 in restricted environments)
- Key decisions with reasoning (targeted fix over full rollback, parallel strategy, page size bump)
- What went well / what didn't go well
- Repair items categorized: must-do, should-do, nice-to-have
- Open questions for the retro meeting

**`cross-team-asks.md`** (5 constructive asks for the upstream team):
1. Downstream consumer notification before reference value expirations
2. Data quality SLA / contract
3. Severity handling for downstream-impacting issues
4. Joint incident coordination protocol
5. Reference value lifecycle visibility

Each ask followed the ask/why/concrete structure with framing notes for delivery.

**`consumer-logic-talking-points.md`** (technical explainer):
- Data flow diagram: Upstream → Pipeline → MapValue → Service Bus → Downstream
- 6 key design facts the room needed to understand
- "What this means for the incident" section
- One-liner summary for quick reference

### What We Learned

- the incident tracker data was 5 days stale — entire draft had to be revised when we re-pulled. **This is why Phase 1 exists.**
- Room dynamics mattered: 2 of our team's members vs 7 from the upstream team. Knowing this ahead of time shaped how we framed talking points.
- The "defensive Q&A" table was the highest-value artifact — it anticipated the exact questions that came up.
- 10+ corrections were needed in one session because early analysis was authoritative-sounding but built on partial data. **This is why confidence labels exist.**
- Cross-team asks document reframed blame into constructive requests, which was well-received.

### Lessons Applied to This Skill

| Lesson | Skill Feature |
|--------|---------------|
| Stale the incident tracker data caused major rework | Phase 1: mandatory fresh pull, degraded mode if unavailable |
| Partial data written as conclusions | Confidence labels on every claim |
| Room dynamics shaped strategy | Stakeholder analysis (internal-only) |
| Anticipated questions were highest-value | Anticipated questions as core output |
| Technical explainer needed for non-obvious topics | Conditional topic-specific docs |
| Multiple output docs needed coordination | Output contracts with required vs conditional |

## Decision Tree

```
User asks to prep for a retro/postmortem/incident review
    │
    ├─ Has initiative path? ──── No ──→ Search initiatives/ for matching incident
    │                                    If not found → ask user
    │
    ├─ Has meeting details? ─── No ──→ Search calendar for upcoming retro/postmortem events
    │                                    If not found → ask user for time + attendees + agenda
    │
    ├─ Has the incident tracker incident ID? ─── No ──→ Check initiative artifacts for the incident tracker references
    │                                    If not found → proceed in degraded mode
    │
    └─ All inputs available ──→ Execute Phase 1–5
                                    ↓
                                Output: retro prep package in initiative directory
```
