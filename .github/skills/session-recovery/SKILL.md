---
name: session-recovery
description: Mine the session_store database to recover context from past sessions. Structured query patterns, FTS5 synonym expansion, and recovery prompt building. Use when asked about past work, resuming topics, or reconstructing context.
---

# Session Recovery

Systematic methodology for querying the `session_store` database (read-only SQLite, accessed via the `sql` tool with `database: "session_store"`) to recover context from past Copilot CLI sessions.

Adapted from the tamirdresher/squad-skills session-recovery plugin — takes query patterns and synonym expansion strategy from it. No scripts; the SQL tool provides direct access.

---

## When to Invoke

- User asks "what did I work on last week / yesterday / recently?"
- User references a past session, PR, or topic ("remember when we fixed auth?")
- Session handover is missing or incomplete — need to reconstruct context
- User asks to find where a decision was made
- Resuming work on a topic after a gap
- Need to locate a file change or commit across sessions

## When NOT to Invoke

- Information is already in working memory (`memory.md`, `log.md`, `rules.md`)
- Topic is in an active initiative with current notes under `initiatives/`
- Simple questions answerable from the current session context
- User is asking about something that never went through Copilot CLI (use Teams/email/ADO instead)

---

## Skill Boundaries

| Skill | Purpose | Distinction |
|---|---|---|
| **session-recovery** (this) | Reconstruct past session context from history | Reads session_store; retrospective |
| **reflect** | Capture new learnings into memory/rules | Writes to working-memory; prospective |
| **fact-check** | Verify current claims against sources | Validates present-tense assertions |
| **analyze** | Audit current artifacts for quality/consistency | Reads initiative files; present-tense |
| **clarify** | Resolve ambiguity by asking the user | Interactive Q&A; forward-looking |

Consult working memory first — it has distilled knowledge. Use session-recovery when you need **provenance, chronology, or missing detail** that working memory doesn't capture. Recovered history may still need **fact-check** before being asserted as authoritative.

---

## Schema Reference

```
sessions        — id, cwd, repository, branch, summary, created_at, updated_at
turns           — session_id, turn_index, user_message, assistant_response, timestamp
checkpoints     — session_id, checkpoint_number, title, overview, history,
                  work_done, technical_details, important_files, next_steps
session_files   — session_id, file_path, tool_name (edit/create), turn_index, first_seen_at
session_refs    — session_id, ref_type (commit/pr/issue), ref_value, turn_index, created_at
search_index    — FTS5 virtual table (content, session_id, source_type, source_id)
```

All queries use `database: "session_store"`.

---

## Query Expansion Strategy

FTS5 is keyword-based, not semantic. You must act as your own "embedder" by expanding conceptual queries into keyword variants. Always use `OR` between synonyms.

### Domain Expansion Table

| Concept | Expansion Keywords |
|---|---|
| auth / identity | `auth OR login OR token OR JWT OR session OR credential OR password OR identity OR MSAL OR OAuth` |
| bug / error | `bug OR fix OR error OR crash OR regression OR debug OR broken OR issue OR exception OR failure` |
| UI / frontend | `UI OR rendering OR component OR layout OR CSS OR styling OR display OR visual OR Fluent OR React` |
| performance | `performance OR perf OR slow OR fast OR optimize OR latency OR cache OR memory OR throughput` |
| API / service | `API OR endpoint OR route OR controller OR REST OR GraphQL OR service OR handler OR middleware` |
| database / data | `database OR SQL OR query OR migration OR schema OR table OR index OR EF OR entity OR model` |
| security | `security OR vulnerability OR CVE OR threat OR RBAC OR permission OR role OR access OR policy` |
| deployment / infra | `deploy OR deployment OR pipeline OR CI OR CD OR Bicep OR ARM OR Azure OR infra OR release` |
| testing | `test OR spec OR assert OR mock OR stub OR coverage OR TDD OR unit OR integration OR E2E` |
| config / settings | `config OR configuration OR settings OR env OR environment OR appsettings OR feature flag` |
| ADO / work items | `ADO OR work item OR story OR bug OR task OR sprint OR iteration OR backlog OR feature OR epic` |
| refactor / cleanup | `refactor OR cleanup OR rename OR extract OR consolidate OR simplify OR modernize OR tech debt` |
| email / comms | `email OR draft OR reply OR inbox OR thread OR recipient OR forward OR send OR message` |
| meetings / calendar | `meeting OR calendar OR invite OR attendee OR prep OR agenda OR follow-up OR 1:1 OR standup` |
| people / org | `manager OR direct OR hiring OR stakeholder OR org OR team OR onboard OR role` |
| memory / provenance | `decision OR handoff OR checkpoint OR next steps OR summary OR commit OR PR OR branch OR merge` |

### Expansion Rules

1. Start with the user's keywords verbatim.
2. Add synonyms and abbreviations from the table above.
3. Add project-specific terms if known (e.g., service names, module names).
4. Cap at ~10-12 OR terms per MATCH clause to avoid excessive noise.
5. Use double quotes for exact phrases: `MATCH '"circuit breaker" OR resilience OR retry'`.

---

## Noise Filtering

### Prefer structured data over raw turns
Checkpoints are curated summaries — start there before diving into turn-level content.

### Date scoping
Always scope by date when the user implies a time range:
```sql
WHERE s.created_at >= date('now', '-7 days')
```

### Exclude noise sessions
Demote (don't exclude) very short sessions — some 2-turn sessions have checkpoints or useful context:
```sql
-- Prefer sessions with more substance, but don't hard-exclude short ones
ORDER BY
  CASE WHEN turn_count >= 3 THEN 0 ELSE 1 END,
  s.created_at DESC
```
Only filter out sessions with 0 turns, no checkpoints, no summary, and no file changes.

### Ranking strategy
1. **Checkpoints first** — most signal per token.
2. **First user message** (turn_index = 0) — captures intent.
3. **Session summary** — quick scan for relevance.
4. **File paths** — concrete evidence of what was touched.
5. **Full turns** — last resort, high noise.

---

## Canned Query Patterns

### 1. What did I work on in the last N days?

```sql
SELECT s.id, s.branch, s.summary,
       substr(t.user_message, 1, 200) as first_ask,
       s.created_at
FROM sessions s
LEFT JOIN turns t ON t.session_id = s.id AND t.turn_index = 0
WHERE s.created_at >= date('now', '-7 days')
ORDER BY s.created_at DESC;
```

### 2. Full-text search with synonym expansion

```sql
SELECT content, session_id, source_type
FROM search_index
WHERE search_index MATCH 'auth OR login OR token OR JWT'
ORDER BY rank
LIMIT 20;
```

### 3. Find all sessions that touched a file

```sql
SELECT s.id, s.summary, sf.file_path, sf.tool_name, s.created_at
FROM session_files sf
JOIN sessions s ON sf.session_id = s.id
WHERE sf.file_path LIKE '%UserSearch%'
ORDER BY s.created_at DESC;
```

### 4. Sessions linked to a PR or issue

```sql
SELECT s.id, s.branch, s.summary, sr.ref_type, sr.ref_value, s.created_at
FROM session_refs sr
JOIN sessions s ON sr.session_id = s.id
WHERE sr.ref_type = 'pr' AND sr.ref_value = '42';
```

### 5. When was a topic last discussed?

```sql
-- Broad LIKE search across first user messages
SELECT DISTINCT s.id, s.branch, s.summary,
       substr(t.user_message, 1, 200) as ask,
       s.created_at
FROM sessions s
JOIN turns t ON t.session_id = s.id AND t.turn_index = 0
WHERE t.user_message LIKE '%circuit breaker%'
   OR t.user_message LIKE '%resilience%'
   OR s.summary LIKE '%circuit breaker%'
ORDER BY s.created_at DESC
LIMIT 10;
```

### 6. Recent session summaries (quick scan)

```sql
SELECT id, branch, summary, created_at
FROM sessions
ORDER BY created_at DESC
LIMIT 15;
```

### 7. Checkpoint deep-dive for a specific session

```sql
SELECT checkpoint_number, title, overview, work_done, next_steps
FROM checkpoints
WHERE session_id = 'SESSION_ID_HERE'
ORDER BY checkpoint_number;
```

### 8. Files edited across sessions in this repo

```sql
-- Note: repository is often NULL; fall back to cwd
SELECT sf.file_path, COUNT(DISTINCT sf.session_id) as session_count,
       MAX(s.created_at) as last_touched
FROM session_files sf
JOIN sessions s ON sf.session_id = s.id
WHERE (s.repository LIKE '%my-agent%'
       OR s.cwd LIKE '%my-agent%')
  AND sf.tool_name = 'edit'
GROUP BY sf.file_path
ORDER BY session_count DESC
LIMIT 20;
```

### 9. Related sessions by shared files

```sql
-- Given a session, find other sessions that touched the same files
SELECT DISTINCT s2.id, s2.summary, s2.created_at,
       GROUP_CONCAT(sf2.file_path, ', ') as shared_files
FROM session_files sf1
JOIN session_files sf2 ON sf1.file_path = sf2.file_path
JOIN sessions s2 ON sf2.session_id = s2.id
WHERE sf1.session_id = 'KNOWN_SESSION_ID'
  AND sf2.session_id != 'KNOWN_SESSION_ID'
GROUP BY s2.id
ORDER BY COUNT(sf2.file_path) DESC
LIMIT 10;
```

### 10. Combine FTS + structured filters

```sql
-- FTS for topic, then join to get file context
SELECT si.session_id, s.branch, s.summary,
       MIN(si.rank) as best_rank,
       GROUP_CONCAT(DISTINCT si.source_type) as match_sources,
       GROUP_CONCAT(DISTINCT sf.file_path) as files_touched
FROM search_index si
JOIN sessions s ON si.session_id = s.id
LEFT JOIN session_files sf ON sf.session_id = si.session_id
WHERE search_index MATCH 'deploy OR pipeline OR CI OR release'
  AND s.created_at >= date('now', '-30 days')
GROUP BY si.session_id
ORDER BY best_rank
LIMIT 15;
```

---

## Recovery Prompt Builder

Two modes depending on what the user needs:

### Quick Recovery (default)

For "what was I doing yesterday?" or simple lookups — 3-5 bullets + likely next step:

```
**Recent work on [topic]** (N sessions, last active [date])
- [bullet] — source: [checkpoint/summary/turn]
- [bullet]
- [bullet]
**Likely next step**: [action from checkpoint next_steps or unfinished work]
```

### Full Recovery

For deep reconstruction, handover gaps, or resuming after a long break — use the full template:

```markdown
## Session Recovery: [topic]

**Sessions found**: N sessions (YYYY-MM-DD to YYYY-MM-DD)
**Search terms**: [expanded keywords used]

### Key Decisions
- [decision] — session [id] on [date] (source: checkpoint/turn)

### Files Modified
- `[file path]` — [what was done] (session [id])

### Commits & PRs
- PR #[N] — [title] (session [id])  *(only if ref exists in session_refs)*
- Commit [sha] — [message] (session [id])  *(only if ref exists)*

### Unfinished Work
- [pending item from checkpoint next_steps] (session [id])

### Related Sessions
- [id] ([date]) — [summary] — shares files: [list]
```

**Provenance rule**: Every bullet must cite its source (checkpoint, summary, turn, ref, file path). If a detail can't be sourced, mark it `(unverified)` or omit it. Never invent missing details to fill the template.

### Builder Workflow

0. **Check store health**: `SELECT COUNT(*) FROM sessions;`
   - **0 sessions** → no historical context; fall back to working memory and current session.
   - **< 10 sessions** → skip aggressive filters, search everything.
   - **10+ sessions** → proceed with full workflow below.
1. **Start broad**: Run canned query #1 or #6 to orient.
2. **Narrow with FTS**: Use expanded keywords (query #2) to find relevant sessions.
3. **Deep-dive checkpoints**: For promising sessions, pull checkpoints (query #7).
4. **Map files**: Identify what was touched (query #3 or #8).
5. **Find links**: Check for PRs/commits (query #4) and related sessions (query #9).
6. **Assemble**: Fill the recovery template. Flag gaps explicitly.
7. **Present**: Share the recovery summary and ask if the user wants to drill into any session.

---

## Tips

- **Start broad, then narrow** — it's better to retrieve too many results and filter than to miss relevant sessions.
- **Combine query types** — FTS for topics, LIKE for file paths, structured joins for refs.
- **Check multiple source_types** — `checkpoint_overview` and `checkpoint_work_done` are highest signal in the search_index.
- **Use `substr()`** — truncate long fields to keep output scannable: `substr(content, 1, 300)`.
- **Session IDs are opaque** — always show branch/summary/date alongside IDs for human readability.
- **Iterate** — if the first query returns nothing, widen synonyms or relax date filters before giving up.
