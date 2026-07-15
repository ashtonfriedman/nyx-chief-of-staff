---
name: meeting-transcript
description: >
  Read meeting transcripts and recaps natively via M365 query tool without downloading files.
  Use when asked to "read the transcript", "get the recap", "what was said in the meeting",
  or "summarize the meeting". Do NOT use for typed chat messages, raw recording files,
  or generic meeting prep when no transcript/recap is needed.
---

# Meeting Transcript Reader

M365 query tool can often access transcript and recap artifacts from recorded Teams meetings
without direct file download. This skill captures the retrieval pattern.

## When to Use

- User asks to read, summarize, or consume a meeting transcript or recap
- You need meeting content for prep, follow-up, or initiative creation
- A meeting chat references a recording/recap and you need the content

## When NOT to Use

- Typed chat messages in a meeting chat — use `ListChatMessages` instead
- Raw video/audio files — this skill does not transcribe recordings
- General meeting prep when no transcript exists

## Phase 1: Identify the Meeting

Resolve the meeting using this fallback order:
1. Calendar event (title + date) — most common entry point
2. Meeting chat thread ID (from a Teams link)
3. Title + approximate date from conversation context

## Phase 2: Retrieve Transcript/Recap

Use `m365-query-ask_work_iq` with a specific query. Effective patterns:

**Full transcript:**
```
Show me the full detailed transcript from the [MEETING TITLE] meeting
on [DATE]. I want everything that was said, by whom, in order.
```

**Recap / summary:**
```
Show me the transcript or recap from the meeting [MEETING TITLE] on [DATE]
```

**Speaker-specific extraction:**
```
From the [MEETING TITLE] transcript on [DATE], quote what [SPEAKER] said about [TOPIC].
```

**Action items only:**
```
From the [MEETING TITLE] transcript on [DATE], extract all action items
and who they were assigned to.
```

If you know the meeting chat thread ID, include it in the query as additional context.

### If M365 query tool returns nothing or errors

**Do not retry more than 2-3 times.** Consistent errors mean the service is down.

Fallback chain (in order):

1. **Graph callRecords transcripts API** — programmatic transcript access if
   permissions allow. Needs the meeting's callRecordId.
2. **Direct OneDrive path construction** — transcripts live in the **organizer's**
   OneDrive at `Recordings/{Title}-{YYYYMMDD}_{HHmmss}UTC-Meeting Recording.vtt`
   (sometimes in a `Transcripts/` subfolder). Use `sharepoint-getFileOrFolderMetadataByUrl`
   to probe the path. 403 means "not shared," not "doesn't exist."
3. **Find the recording first** — `sharepoint-findFileOrFolder` for the `.mp4`.
   The `.vtt` transcript file lives alongside it with the same naming stem.
4. **Ask the organizer to share** — if all mechanical paths fail, the organizer
   can share the `.vtt` from OneDrive or download from Teams meeting details.

**Do NOT:**
- Substitute Copilot meeting chat summaries for the transcript
- Use broad SharePoint search for "transcript" (returns unrelated tenant-wide results)
- Try to read Loop recap files as text (binary Fluid format)

Use the fallback chain above for full retrieval details.

## Phase 3: Label and Deliver

**Always state what you're returning:**
- "This is verbatim transcript text" — direct speaker-attributed quotes
- "This is the meeting recap" — Teams-generated summary
- "This is a M365 query tool-generated summary" — synthesized from transcript, not verbatim

Default to concise summary/action items unless the user explicitly asks for full text.
Only write/store/create follow-on artifacts if the user explicitly asks.

## Limitations

- Transcript must exist (meeting was recorded + transcribed)
- M365 query tool accesses artifacts in the organizer's OneDrive — if deleted, gone
- Very long transcripts may be summarized by M365 query tool rather than returned verbatim;
  ask for specific sections if you need full fidelity
- M365 query tool's first response often collapses mid-transcript sections with editorial
  summaries (e.g., "a teammate continues discussing..."). A targeted follow-up query
  naming the specific collapsed sections retrieves the verbatim text. Plan for
  two M365 query tool calls on any transcript longer than ~15 minutes. For a per-item
  meeting (e.g. field-by-field classification, item-by-item triage), the second
  call should demand the per-item outcome explicitly — "for EACH item state the
  decision, quote the speaker" — which reliably expands the collapsed list. A
  M365 query tool network error on a long, multi-clause query is common; retry once with a
  shorter, simpler re-ask rather than abandoning.
- Tenant policy or indexing delays may prevent access in some cases

## Rules

- Always attribute quotes to speakers from the transcript
- Don't fabricate transcript content — if M365 query tool summarizes, say so
- Label output type (verbatim / recap / summary) every time
- For sensitive meetings, don't store raw transcript in shared surfaces