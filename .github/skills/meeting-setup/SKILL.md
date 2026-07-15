---
name: meeting-setup
description: Create domain knowledge structure for a new recurring meeting. Use when asked to "add a meeting", "set up notes for [meeting]", "track a new recurring meeting", "create a meeting folder", "start a notes doc for [meeting]", "keep notes on [meeting]", "where do I put notes for [meeting]", or when the user describes a new recurring meeting that should be tracked (e.g. "we have a new weekly with...", "John set up a new sync", "I just got a new series invite"). NOT for 1:1s — those are tracked per person, not here.
---

# Meeting Setup

Creates the folder structure and index files for a new recurring meeting under `domains/meetings/`.

## Structure

```
domains/meetings/{group}/
  index.md                        ← group context (members, purpose)
  {meeting}/
    index.md                      ← meeting context (cadence, attendees, chat ID)
```

Meetings nest under their parent group. Groups nest under `domains/meetings/`.

## Step 1: Gather Info

Use `ask_user` to collect what's needed. Don't guess.

| Field | Required | Example |
|-------|----------|---------|
| Group name | Yes | peer-group |
| Meeting name | Yes | t3 |
| Cadence | Yes | Weekly Friday |
| Who runs it | Yes | A teammate |
| Attendees | If known | Names list |
| Teams chat ID | If known | `<thread-id>` |
| Purpose | Yes | 1-2 sentence description |

If the group already exists (`domains/meetings/{group}/index.md`), skip group creation. Just add the meeting subfolder.

## Step 2: Check for Duplicates

```powershell
$mindPath = $env:AGENT_MIND_PATH
if (-not $mindPath) { $mindPath = '<repo>' }

# Check if group exists
Test-Path (Join-Path $mindPath "domains/meetings/$groupSlug/index.md")

# Check if meeting exists under group
Test-Path (Join-Path $mindPath "domains/meetings/$groupSlug/$meetingSlug/index.md")
```

If the meeting already exists, stop and tell the user.

## Step 3: Create Structure

Use kebab-case for folder names. Create directories and files directly (daemon doesn't manage file creation).

### Group index.md (if new group)

```markdown
# {Group Display Name}

{One-line description of the group.}

## Members
- {Name} (runs it)
- {Name}
- ...

## Recurring Meetings
- [[{meeting-name}]] — {cadence}, {brief description}
```

### Meeting index.md

```markdown
# {Meeting Display Name}

{Cadence}. {Who runs it}. {Brief purpose.}

## Chat
Meeting chat: `{chat-id}`
```

Omit the Chat section if no chat ID is provided.

## Step 4: Update Group Index

If the group already existed, append the new meeting to the `## Recurring Meetings` section in the group's `index.md` using the `edit` tool.

## Step 5: Verify

Re-read both index files to confirm they're correct.

## Step 6: Log

Append a one-line entry to `.working-memory/log.md` noting the new meeting structure, using the `edit` tool.

## Rules

- Kebab-case for all folder and file names
- Don't create prep files — those are per-instance and created when needed
- Don't duplicate existing groups or meetings
- If attendees are unknown, leave the Members section with a placeholder
- Chat ID is optional — many meetings don't have a persistent chat
