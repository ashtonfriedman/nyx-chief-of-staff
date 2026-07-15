---
name: daily-report
description: Generates a comprehensive daily report covering ADO work items, Teams chats, calendar, email, local mind next-actions, and inbox notes. Run this each morning to get a scannable summary of everything you need to know to start your day. Use when user asks for "daily report", "morning briefing", or "what's on my plate today".
---

# Daily Report Skill

## Purpose

Generate a terse, scannable daily report every morning that covers:
- Azure DevOps work item status (active, aging, state changes)
- Teams chat activity (monitored chats + direct mentions)
- Today's calendar and yesterday's meeting recaps
- Urgent and VIP emails + threads awaiting reply
- Local mind next-actions across all initiatives
- Inbox notes and active initiative listing

## Required Configuration

This skill reads user-specific values from the user's global copilot instructions (`~/.copilot/copilot-instructions.md`). The following sections must be present:

### Azure DevOps Defaults
- **Organization** — ADO org URL (e.g., `https://dev.azure.com/myorg`)
- **Project** — ADO project name
- **Area Path** — Area path for work item queries (with `UNDER` semantics)

### Teams Channels
A list of Teams group chats to monitor, each with:
- **Chat Name** — display name of the chat
- **Thread ID** — the `19:...@thread.v2` identifier for reliable querying

### VIP Contacts
A list of people whose communications should be surfaced with higher priority.

> **Fallback:** If any required configuration section is missing, ask the user for the values and offer to add them to `~/.copilot/copilot-instructions.md`.

## How to Execute

Execute in 3 steps. ADO is fetched FIRST so that work item titles and IDs can be passed as context into the Teams and email queries for better correlation.

### Step 1: Fetch ADO Context (run both in parallel, BEFORE other queries)

These queries establish what the user is actively working on. Their results (work item titles and IDs) will be injected into the Teams and email queries in Step 2.

**IMPORTANT:** Always use `-o table` for `az boards query` output. Do NOT use `-o json` — the CLI can produce malformed JSON when work item titles contain newlines or special characters.

> **Note:** Substitute `{ADO_ORG}`, `{ADO_PROJECT}`, and `{ADO_AREA_PATH}` with the values from `## Azure DevOps Defaults` in global copilot instructions.

**Query 1a — ADO: Active + recently completed work items**
```powershell
az boards query --wiql "SELECT [System.Id], [System.Title], [System.State], [System.WorkItemType], [System.CreatedDate], [Microsoft.VSTS.Common.Priority], [Microsoft.VSTS.Common.StateChangeDate] FROM WorkItems WHERE [System.AssignedTo] = @Me AND ([System.State] NOT IN ('Closed', 'Removed', 'Done') OR ([System.State] IN ('Closed', 'Done') AND [Microsoft.VSTS.Common.ClosedDate] >= @Today - 30)) AND [System.AreaPath] UNDER '{ADO_AREA_PATH}' ORDER BY [Microsoft.VSTS.Common.Priority] ASC" --org "{ADO_ORG}" -p "{ADO_PROJECT}" -o table
```

**Query 1b — ADO: State changes in last 24h**
```powershell
az boards query --wiql "SELECT [System.Id], [System.Title], [System.State], [System.ChangedDate], [System.ChangedBy] FROM WorkItems WHERE [System.AreaPath] UNDER '{ADO_AREA_PATH}' AND [System.ChangedDate] >= @Today - 1 ORDER BY [System.ChangedDate] DESC" --org "{ADO_ORG}" -p "{ADO_PROJECT}" -o table
```

After running these, extract the list of work item titles and IDs. Build a comma-separated summary string of your active work items, e.g.:
`"#ID1 Title1, #ID2 Title2, #ID3 Title3, ..."`

This becomes `{WORK_ITEMS_CONTEXT}` used in Step 2.

### Step 2: Gather M365 Data (run ALL in parallel, using ADO context)

**Invoke `skill(m365-query)` before running any queries in this step.** All M365 data must be retrieved using the M365 query tool CLI via that skill.

> **Correlation note:** Work item IDs are injected into queries for context enrichment. Expect *thematic* correlation (M365 query tool connecting discussion topics to your work areas), not literal ID matches — people rarely cite ADO IDs in conversation. This is normal and the thematic matches are valuable.

**Query 2a — Teams: Monitored chat rollups**

For each chat listed in `## Teams Channels` in global copilot instructions, run a query using this template:
```
m365-query ask -q "Summarize messages sent since {YESTERDAY_DATE} in the Teams chat thread {THREAD_ID} (this is the '{CHAT_NAME}' group chat). For context, my current work items are: {WORK_ITEMS_CONTEXT}. Organize by: 1) Any mentions of me or my work items, 2) Open questions needing input, 3) Decisions made, 4) Action items assigned, 5) Announcements or knowledge sharing. Correlate any discussion topics to my work items where relevant. Include links to messages. Be concise. Bullet points only. No follow-up offers."
```

Where `{YESTERDAY_DATE}` is yesterday's date in YYYY-MM-DD format.

> **Timestamp fallback:** If M365 query tool reports it cannot reliably scope messages to the requested time window, note the limitation in the report and include whatever summary M365 query tool was able to provide. Do not skip the section entirely.

Run all chat queries in parallel.

**Query 2b — Teams: Direct mentions across all chats**
```
m365-query ask -q "Find any Teams messages sent since {YESTERDAY_DATE} where I was directly mentioned or tagged, across all chats and channels. List each with the chat name, who mentioned me, and what they said. Note if any relate to these work items: {WORK_ITEMS_CONTEXT}. Be concise. Bullet points only. No follow-up offers."
```

**Query 2c — Calendar: Today's meetings**
```
m365-query ask -q "What meetings do I have today, {TODAY_DATE}? For each meeting, list the time, title, attendees, and any agenda or related context. Flag any scheduling conflicts. Note if any meetings relate to these work items: {WORK_ITEMS_CONTEXT}. Be concise. Bullet points only. No follow-up offers."
```

**Query 2d — Calendar: Yesterday's meeting recaps**
```
m365-query ask -q "Summarize decisions and action items from meetings I attended yesterday, {YESTERDAY_DATE}. Use transcripts if available. Note if any relate to these work items: {WORK_ITEMS_CONTEXT}. Be concise. Bullet points only. No follow-up offers."
```

**Query 2e — Email: Urgent/VIP emails**
```
m365-query ask -q "Find emails from the last 24 hours that are either marked high importance OR are from anyone listed in ## VIP Contacts in the user's global copilot instructions. Summarize each briefly and flag any that need my reply. Note if any relate to these work items: {WORK_ITEMS_CONTEXT}. Be concise. Bullet points only. No follow-up offers."
```

**Query 2f — Email: Awaiting my reply**
```
m365-query ask -q "Find email threads from the last 48 hours where someone asked me a direct question or is waiting for my response. List sender, subject, and what they're waiting on. Be concise. Bullet points only. No follow-up offers."
```

### Step 3: Gather Local Mind Data + Assemble Report

**3a — Collect open next-actions from the mind**

Each `next-actions.md` file uses `## Open` / `## Done` sections with `- [ ]` (open) and `- [x]` (done) checkboxes.

1. Read `inbox/next-actions.md` for untriaged actions
2. List folders under `initiatives/` to discover active initiatives
3. For each initiative folder, read its `next-actions.md` file (if the file doesn't exist, skip that initiative silently)
4. Extract only `- [ ]` (open) items — skip done items
5. Group open actions by source (inbox vs each initiative name)

Use parallel `view` calls to read all next-actions.md files at once for efficiency.

**3b — Review inbox notes**

1. List the inbox folder
2. **You MUST read each markdown file's contents** (excluding `next-actions.md` and `READ-THIS.md`) using parallel `view` calls — do not just list filenames
3. For each file, extract any action items, deadlines, or tasks
4. Summarize key items not already captured in next-actions

**3c — Scan meeting notes for today's context**

The meeting notes folder lives at `{USER_HOME}\Documents\meetingNotes`. This step requires `/add-dir` access — if not available, skip with a note in the report.

1. Read `Tasks/ToDo.txt` — extract any open `[]` items from the most recent date block
2. Check today's calendar (from Step 2c) for any 1:1 meetings with direct reports or hierarchy
3. For each person with a meeting today, read their 1:1 notes file:
   - Direct reports: `1on1s/directs/{name}.txt`
   - Peers: `1on1s/peers/{name}.txt`
   - Hierarchy: `1on1s/hierarchy/{name}.txt`
   - {your-team}: `1on1s/{your-team}/{name}.txt`
4. Extract: last meeting notes, open action items, recent coaching points, personal context
5. Cross-reference with their section in `MEMORY_BANK.md` for role level, growth pathway, and current focus
6. Read `1on1s/directs/{review-cycle}/` folder if any performance review meetings are on today's calendar

Use parallel `view` calls for all file reads.

**3d — List active initiatives**

List initiative folder names from `initiatives/` — names only, do not dive into contents.

**3d — Assemble the report**

Combine all results into the format below. Use bullet points. Be terse. Skip empty sections with "— Nothing to report". Present all times in Eastern Time (ET).

**When processing M365 query tool responses:** Extract only the data points (names, dates, subjects, decisions, action items). Discard conversational scaffolding, disclaimers, offers to do more, and "if you want I can..." suggestions. The report should contain facts, not M365 query tool's commentary.

```
═══════════════════════════════════════════
  🌅 DAILY REPORT — {today's date}
═══════════════════════════════════════════

🔔 MENTIONS & DIRECT REQUESTS
  {mentions from all chats, tagged items}

❓ OPEN QUESTIONS
  {unresolved threads needing your input}

✅ DECISIONS MADE (last 24h)
  {decisions from chats and meetings}

📌 ACTION ITEMS
  {commitments by/to you from chats and meetings}

📅 TODAY'S MEETINGS
  {time | title | key attendees | prep notes}

📝 YESTERDAY'S MEETING RECAPS
  {decisions and action items from yesterday}

🚨 URGENT / VIP EMAILS
  {high-priority emails and VIP sender emails}

📬 AWAITING YOUR REPLY
  {email threads waiting on you}

📋 ACTIVE WORK ITEMS (ADO)
  {#ID | Type | Title | State | Priority | Age in days}

✅ RECENTLY COMPLETED (last 30 days)
  {#ID | Type | Title | Closed date}

🔥 AGING ITEMS (>14 days)
  {work items activated >14 days ago still open}

🚦 ADO STATE CHANGES (last 24h)
  {items that changed state, who changed them}

📓 NEXT ACTIONS (Mind)
  Inbox:
    {open items from inbox/next-actions.md}
  [Initiative Name]:
    {open items from initiative/next-actions.md}
  (Omit sections with no open items)

📋 MEETING NOTES TASKS
  {open [] items from Tasks/ToDo.txt — most recent date block only}

👥 1:1 PREP (today's meetings only)
  [Person Name] ({role level} — {current focus}):
    Last discussed: {key points from last 1:1 notes}
    Open items: {action items from their notes}
    Coaching: {growth pathway, recent progress, coaching opportunities}
    Personal: {relevant personal context — National Guard, travel, milestones}
  (Only include people with meetings today. Omit if no 1:1s scheduled.)

📥 INBOX NOTES
  {summary of untriaged inbox notes needing attention}

🚀 ACTIVE INITIATIVES
  {initiative folder names}

💡 KNOWLEDGE DROPS
  {useful tips, links, learnings shared in chats}

🎯 FOCUS RECOMMENDATIONS
  {top 3 suggested priorities based on urgency, age, blockers, and meetings}

═══════════════════════════════════════════
```

## Formatting Rules

- **Terse and scannable** — bullet points only, no prose paragraphs
- Include Teams message links where available
- For ADO items, format as: `#ID | Type | Title | State | P{priority} | {age}d`
- For meetings, format as: `HH:MM - HH:MM ET | Title | Key attendees`
- For emails, format as: `From: {sender} | Subject: {subject} | {action needed}`
- Empty sections: show "— Nothing to report"
- Focus recommendations: pick top 3 items based on urgency, blockers, upcoming meetings, aging items, and 1:1 prep context
- All times in Eastern Time (ET)

## ADO Thresholds

- Aging: 14 days (flag as 🔥)
- Stale: 30 days (flag as 🚨)
- Calculate age from `System.CreatedDate` or `Microsoft.VSTS.Common.ActivatedDate`

## Constraints

- Do not fabricate data — only report what comes from M365 query tool, ADO queries, and local mind files
- If a query fails, note the failure in the report and continue with other sections
- Do not send emails or modify work items — this is read-only
- Always include the date in the report header
- Always invoke `skill(m365-query)` before any M365 queries in Step 2
