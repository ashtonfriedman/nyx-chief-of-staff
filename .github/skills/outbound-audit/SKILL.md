---
name: outbound-audit
description: >
  Log, query, and summarize all outbound actions. Use when taking any external action
  (Teams post, email, calendar, SharePoint, ADO, GitHub) or when asked
  "what did you send?", "show outbound actions", "audit log", or "boot summary".
---

# Outbound Communications Audit

Mandatory audit logging for every outbound action this agent takes. Born from a real incident
where a session handoff leaked private feedback to leadership. This is not
optional. Every external action gets logged. No exceptions.

**Spec:** `initiatives/outbound-comms-audit/spec.md`
**Log file:** `.working-memory/outbound-audit.jsonl`
**Boot marker:** `.working-memory/last-outbound-boot.txt`

---

## When to Invoke This Skill

- **Boot**: Phase 4 (Boot Summary) runs automatically via `boot-context.mjs` — no manual step
- **Before/after any outbound action**: Run Phase 1 (Write Intent) → execute action → Phase 2 (Write Result)
- **On user query**: Run Phase 3 (Query) when asked about outbound activity
- **Inline rule**: The rule at line 175 of `rules.md` mandates this. This skill is the HOW.

---

## Phase 1: Write Intent Entry (BEFORE the outbound action)

Before executing any outbound action, write an intent entry to the audit log.

### Step 1: Classify the action type

| If you are about to... | action-type |
|------------------------|-------------|
| Post to a Teams chat | `teams-post` |
| Reply to a Teams channel thread | `teams-reply` |
| Send an email | `email-send` |
| Write to SharePoint | `sharepoint-write` |
| Mutate a calendar event | `calendar-mutate` |
| Create/update ADO work item, PR, or comment | `ado-write` |
| Comment on GitHub PR/issue, create PR | `github-write` |

If the action does not fit any type, use the most specific match or note the gap.

### Step 2: Scan for PII

Check the outbound content against known person identifiers from your people directory:

1. **Build the PeopleRegistry** (cache at session start, refresh every 5 minutes):
   - Walk the person directories under your people directory.
   - For each person directory, read the primary markdown file (e.g., `index.md` or
     `{name}.md`) and extract:
     - **Full name** (from title/heading or filename: `jane-doe` → "Jane Doe")
     - **First name** and **last name** separately
     - **Nicknames** (e.g., "JD" for Jane Doe — check for Nickname/Alias fields)
     - **Email aliases** if present (e.g., `j-doe`, `jdoe2`)
   - If files are unavailable, fall back to folder name conversion as minimum.
2. For each identifier (full name, first name, last name, nickname, alias), check if
   it appears in the content using **whole-word case-insensitive boundary match** (`\b<name>\b`).
   Skip common-word names that cause false positives (e.g., single-letter names, "May", "Will")
   by requiring minimum 3 characters for first/last name standalone matches.
3. Set `contains-pii: true` if any identifier matches.

### Step 3: Scan for sensitive context

If the content contains ANY of these patterns, set `contains-sensitive-context: true`
and the action is **permanently blocked** (FR-011b). Target does not matter.
- Performance management language: "performance plan", "PIP", "coaching conversation",
  "performance review", "growth area", "development plan"
- Investigation language: "investigation", "incident", "root cause" combined with a person
  reference
- HR-sensitive: "accommodation", "leave", "termination", "separation"
- Private assessment language: "gap between X and Y" about a person's work patterns

Set `contains-sensitive-context: true`.

When in doubt, flag it. False positives are acceptable. False negatives are not.

**⛔ HARD BLOCK — NO OVERRIDE**: If `contains-sensitive-context` is `true`:
- **DO NOT SEND.** The outbound action is dead. No approval can override this.
- Surface the flagged content to the user in the console with the specific sensitive phrases highlighted.
- Offer to write the content to a local file if the user wants to send it manually.
- Do NOT ask "should I send it anyway?" — the answer is always no. The agent cannot send it. Period.
- This applies to ALL action types: Teams, email, peer/self notes, ADO, GitHub, SharePoint, calendar — everything.
- **Write the intent entry** (Step 5) with `contains-sensitive-context: true`, `user-approved: false`, `approval-source: "not-applicable-hard-block"`. **Redact the blocked content**: set `content: null` and add `content-hash: "<sha256 of the original text>"`. Never persist the sensitive text verbatim in the log — the hash keeps the entry auditable (provable + dedupable) without storing what was blocked.
- **Immediately write a blocked result entry** (same `entry-id`) with `status: "blocked"`, `error: "[SENSITIVE-CONTEXT-HARD-BLOCK]"`, and the same `content: null` + `content-hash`. This closes the entry — it is NOT an unresolved intent.
- Skip Phase 2 (there is no action to record a result for).

This is not a gate. Gates can be opened. This is a wall.

### Step 4: Determine approval source

| Condition | approval-source |
|-----------|----------------|
| Action was hard-blocked by FR-011b | `not-applicable-hard-block` |
| The user explicitly reviewed and approved the draft in this session | `explicit-user-review` |
| Action is Tier 1 (autonomous, no approval needed per defense posture) | `tier-1-autonomous` |
| The user saw the draft via Tier 3 STOP mechanism and didn't stop it | `tier-3-draft-reviewed` |
| Running in cron/maintenance session with approveAll | `cron-sdk-auto` |
| Cannot determine | `unknown` |

**If hard-blocked**: set `user-approved: false` and `approval-source: "not-applicable-hard-block"`. Skip normal approval logic.

Set `user-approved: true` ONLY if approval-source is `explicit-user-review` or
`tier-3-draft-reviewed`. For `cron-sdk-auto`, always set `user-approved: false`.

### Step 5: Write the intent entry

Generate a UUID v4 for `entry-id`. Append a single JSON line to
`.working-memory/outbound-audit.jsonl` (create the file on first write if it
does not exist):

**CRITICAL**: The entry must be written and visible on disk BEFORE you make the API call.
Hold the `entry-id` value — you need it for Phase 2.

Write as a **single JSON line** (no pretty-printing — JSONL requires one object per line):

```
{"schema-version":"1.0","entry-id":"<uuid-v4>","timestamp":"<ISO-8601-UTC>","action-type":"<type>","target":"<dest>","content":"<FULL content>","session-id":"<id>","user-approved":false,"approval-source":"<source>","status":"intent","error":null,"contains-pii":false,"contains-sensitive-context":false,"parent-entry-id":null}
```

---

## Phase 2: Write Result Entry (AFTER the outbound action)

Immediately after the outbound action completes (success or failure), append the result
as a **single JSON line** with the SAME `entry-id`:

```
{"schema-version":"1.0","entry-id":"<SAME-ID>","timestamp":"<ISO-8601-UTC>","action-type":"<same>","target":"<same>","content":"<same>","session-id":"<same>","user-approved":<same>,"approval-source":"<same>","status":"success","error":null,"contains-pii":<same>,"contains-sensitive-context":<same>,"parent-entry-id":<same>}
```

Only `status`, `error`, and `timestamp` may differ from the intent entry.

**If you lost the entry-id** (context compaction), search backward through the
audit log for the latest unresolved `intent` entry matching your `session-id` +
`action-type` + `target` to recover the correct entry-id.

---

## Phase 3: Query Outbound Actions

When the user asks about outbound activity ("what did you send today?", "show me
Teams posts from this week", "any PII-flagged entries?"):

1. Read `.working-memory/outbound-audit.jsonl`
2. Parse each line as JSON
3. **Deduplicate by entry-id**: group intent+result pairs, show latest status per action
4. Apply filters based on the query:
   - By date: compare `timestamp` to requested range
   - By action type: match `action-type` field
   - By target: partial match on `target` field
   - By PII flag: filter on `contains-pii` or `contains-sensitive-context`
   - By status: filter on `status` (failures, successes, unresolved intents)
5. Present results as a scannable table: timestamp, action-type, target (truncated), status, PII flags
6. Offer to show full content for any entry by entry-id

**Count rule**: report counts of ACTIONS (deduplicated by entry-id), not raw log lines.

---

## Phase 4: Boot Summary

**Automated.** `.github/scripts/boot-context.mjs` computes and prints this summary
on every session boot — you do not run it manually. The script reads the audit
log, windows activity counts to entries newer than `last-outbound-boot.txt`,
scans for unresolved intents **globally** (a dangling intent is a standing
liability until closed, so it surfaces every boot — not just once), advances the
boot marker, and emits a one-line summary plus a BOOT ACTION when unresolved
intents exist. It never mutates the audit log and never writes audit data to the
graph or sync (PII boundary).

Re-run manually only for on-demand checks (the steps below mirror the script):

1. Check if `.working-memory/outbound-audit.jsonl` exists. If not, say nothing.
2. Read `.working-memory/last-outbound-boot.txt` for prior boot timestamp.
   If missing, treat all entries as new (first boot with audit).
3. Read the audit log. Window activity counts to entries newer than last-boot.
4. Deduplicate by `entry-id` (keep latest status per action). All counts below
   are ACTIONS (unique entry-ids), not raw log lines.
5. Count actions by type, count failures, count PII-flagged, count sensitive-context-flagged.
6. Find unresolved intents **across the entire log** (not just since last boot):
   entries with `status: "intent"` and no result entry sharing the same `entry-id`.
7. Report ONE line:

   Format: `📋 Outbound since last session: {N} actions ({breakdown by type}), {F} failures, {P} PII-flagged, {S} sensitive-context. {U} unresolved intents outstanding.`

   If no new actions: `📋 No outbound actions since last session.` (append `{U} unresolved intents outstanding.` if any exist)

   If unresolved intents exist, also surface a BOOT ACTION: `⚠️ {U} actions have no result — possible crash or context loss.`

8. Write current UTC timestamp to `.working-memory/last-outbound-boot.txt`.

**Boot summary reports counts only. Never include message content in the summary.**

---

## Rules

- NEVER skip the intent entry. Intent first, then act. No exceptions.
- NEVER truncate the content field — except for hard-blocked (sensitive-context) entries, which store `content: null` + a `content-hash` so the sensitive text is never persisted. For all sent actions, log full verbatim content.
- NEVER set `user-approved: true` for cron/maintenance sessions.
- NEVER include audit findings or PII counts in shared or peer summaries.
- NEVER use `git add -A` to stage files — audit log must stay out of git.
- If the audit log file is unwritable, surface a BLOCKING error. Do not proceed
  with the outbound action silently.
- If you execute an outbound action via a shell script (not MCP), you still must
  write intent and result entries manually.
