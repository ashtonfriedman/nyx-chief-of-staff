---
name: one-on-one-prep
description: Generates 1:1 meeting prep for upcoming direct report, peer, and hierarchy 1:1s. Pulls from meeting notes, Teams chats, and email to surface topics, open threads, and questions. Use when user asks to "prep my 1:1s", "prep for [person]", or "get ready for my directs".
---

# 1:1 Prep Skill

## Purpose

Generate prep notes for upcoming 1:1 meetings by cross-referencing three data sources per person:

1. **Meeting notes** — the tail of the person's notes file for recent context
2. **Teams messages** — recent chats with/about the person for live activity
3. **Email** — recent emails from/to the person for anything that might have been missed

Output goes to two places:
- **Mind** — dated prep file under `domains/people/{group}/{person}/`
- **Dashboard** — `oneOnOnePrep` section in dashboard JSON

## How to Execute

### Step 0: Identify 1:1s

Query the calendar for today's (or target date's) events. Filter to 1:1 meetings by:
- Exactly 2 attendees (user + one other)
- Or subject contains "1:1"

Map each attendee to their person folder in `domains/people/`. If no folder exists, create one under the appropriate group (directs/, peers/, hierarchy/) with an `index.md`.

Group assignment comes from `{USER_HOME}\Documents\meetingNotes\1on1s\`:
- `directs/` → `domains/people/directs/`
- `peers/` → `domains/people/peers/`
- `hierarchy/` → `domains/people/hierarchy/`

### Step 1: Pull Meeting Notes

For each person, read the tail (~60 lines) of their meeting notes file:
```
{USER_HOME}\Documents\meetingNotes\1on1s\{group}\{filename}
```

The filename may not match the folder name exactly (e.g., "{TEAM_MEMBER}.txt" for {TEAM_MEMBER}, "{TEAM_MEMBER}.txt" for {TEAM_MEMBER}). Maintain a mapping in the person's `index.md` if the name differs.

Extract:
- Topics from the last 1-2 sessions
- Open items, action items, follow-ups
- Any flags or concerns from prior notes

### Step 2: Search Teams Messages

Run a Teams message search for the person's full name, covering the last 3 days (or since the last 1:1, whichever is longer):
```
teams-SearchTeamsMessages: "messages from {Person Full Name} in the last 3 days"
```

Extract:
- Status updates, PR activity, technical discussions
- Decisions made without the user present
- Anything that implies a blocker or a win

### Step 3: Search Email

Search email for recent messages from/to the person:
```
mail-SearchMessages: "emails from {Person Full Name} in the last week"
```

Extract:
- Action items or requests
- Topics not covered in Teams (formal proposals, external comms, escalations)
- Anything the user might have missed

**This step is critical.** A teammate's security-review email surfaced an entire agenda topic that would have been missed otherwise. Don't skip this.

### Step 4: Synthesize Prep Note

Create (or update) a dated prep file:
```
domains/people/{group}/{person}/YYYY-MM-DD-prep.md
```

Format:
```markdown
# {Person Name} — 1:1 Prep, {date}

## Since Last 1:1 ({last date})

From notes:
- {bullet summary of last session's open items and status}

From Teams (last N days):
- {bullet summary of Teams activity}

From email:
- {bullet summary of email findings, or "Nothing notable" if clean}

## Topics to Cover

- {Topic name}
  {Detail/question on indented line}
  {Additional question on its own indented line}
- {Next topic}
  {Detail}
```

For directs with sensitive context (performance conversations, growth plans), add a `## Watch For` section with behavioral indicators to monitor.

### Step 5: Update Dashboard

Add/update entries in the `oneOnOnePrep` array in `dashboard-data.json`:
```json
{
  "person": "Display Name",
  "time": "2:00 PM",
  "topics": [
    {"label": "Topic Name", "text": "Brief context and questions"}
  ]
}
```

Use 12-hour time format. Keep topic text concise for the dashboard card (full detail lives in the prep file).

### Step 6: Verify

Re-read each prep file to confirm it's accurate and complete. Don't fabricate topics — if a data source returns nothing, note it and move on.

## Triggering

This skill can be invoked:
- **Explicitly:** "prep my 1:1s", "prep for [person]", "get ready for my directs"
- **As part of daily dashboard:** When populating the dashboard, check if there are 1:1s today and run this skill for each
- **Night before:** User may ask to prep the next day's 1:1s before bed (e.g., the evening before a busy meeting day)

## Data Source Notes

- **Meeting notes** are the primary source of continuity. Always read them first.
- **Teams** catches real-time activity the notes haven't captured yet.
- **Email** catches formal/async communication that doesn't always surface in Teams.
- Fire all three Teams/email searches in parallel per person — they're independent.
- For multiple people, fire all searches in parallel across people too.

## Constraints

- Never fabricate topics or questions. Only surface what the data supports.
- Match the user's voice in any externally-posted content (warm, collaborative).
- Prep files are internal (mind artifacts). Meeting notes are the user's artifacts — don't write to them without explicit approval.
- Person index.md files are living documents. Update open threads after each 1:1 when the user shares outcomes.
