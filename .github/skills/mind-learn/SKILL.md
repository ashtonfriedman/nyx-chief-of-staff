---
name: mind-learn
description: >
  Extract and persist session learnings into the mind. Writes domain knowledge,
  expertise notes, and skill observations — no rules, no log entries. Use when
  asked to "apply learnings", "save what you learned", "capture learnings", "mind
  learn", or at session end when there's durable knowledge worth preserving.
---

# Mind Learn

Extract durable knowledge from the current session and write it to the
appropriate mind locations. This is the "what did you learn?" protocol,
mechanized.

## When to Invoke

- User says "mind learn", "apply learnings", "save learnings", "capture what you learned"
- End of a substantive session where new domain/expertise knowledge was gained
- After a deep investigation, incident, or architecture discussion

## What It Captures

| Category | Destination | What goes here |
|----------|-------------|----------------|
| Domain | `domains/` | Facts about services, teams, systems, people — the living context |
| Expertise | `expertise/` | Patterns, techniques, API gotchas, reference material — durable how-to knowledge |
| Initiative | `initiatives/` | Meeting notes, action items, design decisions, next-actions — project-specific context |
| Skills | `.github/skills/` | Observations about skill gaps, new skill ideas, or improvements to existing skills |

## What It Does NOT Capture

- **Rules** — Those go through the `reflect` skill with its approval gate. Do NOT create rules here.
- **Log entries** — Raw observations go to `.working-memory/log.md` via normal session flow. Do NOT write learnings to the log.
- **Ephemeral context** — If it won't matter next week, don't persist it

## ⛔ Anti-Pattern: Document the Gap, Walk Away

If you discover a broken script or fixable bug *while* applying learnings, **fix
it**. Writing "noted as gap, not patched" in the report is documenting a problem
you're already holding the tools to solve. mind-learn captures knowledge — but
knowledge includes code fixes when the fix is adjacent to the learning. Don't
treat skill boundaries as an excuse to leave easy work undone.

## ⛔ Anti-Pattern: Log Dumping

**Do NOT dump learnings into `.working-memory/log.md`.** This is the single most common
failure mode. When you learn something, the lazy path is to append it all to the log.
The correct path is to route each learning to the right location:

- Fact about a person → `domains/people/{group}/{person}/` (group = directs/peers/hierarchy, or ungrouped)
- Fact about a service → `domains/{service}/`
- Reusable technical knowledge → `expertise/{topic}/`
- Initiative-specific context → `initiatives/{initiative}/`
- Meeting outcomes → `initiatives/{initiative}/meetings/`
- Next actions → `initiatives/{initiative}/next-actions.md`

The log gets a one-line pointer at most ("Captured deny-assignment knowledge to
domains/access/access.md"). The log is for raw chronological observations — not a junk
drawer for everything you learned.

**If you find yourself writing more than 3 lines to log.md about something you learned,
you're putting it in the wrong place.** Stop, classify it, and route it to where a
future session will actually find it.

## Workflow

### Step 0: Query the graph FIRST (mandatory gate)

Before inventorying or searching anything, run the graph query CLI. This is the
single most-skipped step — and skipping it is what produces duplicate notes and
misplaced learnings.

```powershell
node "{USER_HOME}\my-agent\graph\graph-cli.js" query "<topic keywords>" --limit 8
```

⚠️ **Query with 1–3 keywords, not a sentence.** FTS5 ANDs bare terms, so a
long natural-language phrase scores zero the moment one rare word is absent —
even when the node exists. A zero-result means *re-query with fewer/broader
keywords*, NOT "it's unindexed." See the `graph-query` skill for details.

⛔ **Do NOT reach for `glob` or `grep` first.** The graph is the index; glob/grep
are literal-text fallbacks for *after* the graph points you at a file. If your
first search tool on a topic is glob, you have already made the mistake — stop
and run the query above. Glob finding "no matches" does NOT mean the knowledge
doesn't exist; it means you searched the wrong layer.

Follow returned nodes to their `source_file` to find the real home. A dangling
wikilink-stub node (empty description, null `source_file`) is not a real note —
keep looking for the actual file.

⚠️ **`source_file` can be stale.** The graph is an index, not ground truth.
After the graph points you at a path, **verify it exists on disk** with `view`
before creating anything. If the path doesn't exist, browse the parent directory
to find where the content actually lives. Creating a folder at a stale
`source_file` path produces garbage you have to clean up later.

### Step 1: Inventory

Review the session and list candidate learnings. For each, classify as
domain, expertise, initiative, or skill. Be specific — "learned about Graph API" is
too vague; "Graph mail queries need parentFolderId eq 'inbox'" is right.

### Step 2: Route

For each learning:

1. **Search first** — graph query (Step 0), *then* grep for literal text. Does a note already exist?
2. **If exists** — update the existing file with `edit` (append a section or revise in place)
3. **If new** — create a new file in the right location with `create`

File placement:
- Domain facts about a person → `domains/people/{group}/{person-slug}/` (group = directs/peers/hierarchy, or directly under `people/` if ungrouped)
- Domain facts about a service → `domains/{service-slug}/`
- Reusable expertise → `expertise/{topic-slug}/{topic-slug}.md`
- Meeting notes + action items → `initiatives/{initiative}/meetings/`
- Design decisions → `initiatives/{initiative}/design/`
- Next actions → append to `initiatives/{initiative}/next-actions.md`
- Skill improvements → update `.github/skills/{skill}/SKILL.md` directly. These are operational fixes, not code — treat them like updating a runbook.

### Step 3: Write

Use `create` for new files and `edit` for updates. This is a single-repo mind —
there is no daemon and no separate mind repository, so writes go straight to disk.

**After creating a NEW file, index it — don't leave it invisible to the graph.**
A new note is not discoverable via `graph-cli query` until it's indexed. You do
**not** need a full reindex; index just the one file (~150ms):

```powershell
node "{USER_HOME}\my-agent\graph\graph-cli.js" index --file "expertise\<topic>\<topic>.md"
```

Then verify with a keyword query that the node resolves. Skipping this is why a
future session "can't find" knowledge you just wrote.

Keep notes concise. These are reference material, not narratives. Use:
- Headings for scanability
- Tables for structured data
- Code blocks for API patterns and examples
- Wiki-links for cross-references

### Step 4: Report

Tell the user what was written and where. Format:

```
Learnings applied:
  ✓ expertise/ (created reusable Graph mail API note)
  ✓ domains/core-service/core-functions.md (updated)
  ✗ skill observation: new skill idea noted, not written
```

## Parallelism

When there are 3+ independent writes, spin up agents to handle them in
parallel. Each write is independent — no ordering constraints.

## Quality Bar

A learning is worth persisting if:
- It would save 5+ minutes in a future session
- It corrects a misconception that could cause a mistake
- It documents something that isn't obvious from the source material
- It connects dots between systems that aren't documented elsewhere

If nothing in the session meets this bar, say so and write nothing. Empty
sessions don't need manufactured learnings.
