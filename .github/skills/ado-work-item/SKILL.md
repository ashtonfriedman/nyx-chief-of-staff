---
name: ado-work-item
description: Create, update, or delete ADO work items with mandatory draft approval and team conventions. Use when asked to "create a bug", "file a story", "update a work item", "add to the sprint", or any ADO work item mutation.
---

# ADO Work Item Skill

## Purpose

Mechanically enforce the draft-approve-execute workflow for ALL ADO work item mutations.
This exists because rules alone failed — description format, parent links, field selection,
and approval gates were repeatedly skipped. The skill makes correct behavior the only path.

## Iron Rule

**NEVER create, update, or delete a work item without showing a draft and receiving
explicit approval.** No shortcuts. No "I'll fix it after." Draft → review → act.

## Workflow

### Step 1: Gather Context

Before writing anything:

1. **Determine work item type**: Bug, User Story, Task, Feature
2. **Find the parent**: Ask if not obvious. For bugs without a clear parent feature,
   use the current half's Misc/Bugs feature:
   ```
   az boards query --wiql "SELECT [System.Id], [System.Title] FROM WorkItems
     WHERE [System.Title] CONTAINS 'Misc' AND [System.Title] CONTAINS 'Bug'
     AND [System.WorkItemType] = 'Feature'
     AND [System.AreaPath] UNDER '{AREA_PATH}'
     AND [System.State] <> 'Removed'
     ORDER BY [System.CreatedDate] DESC" --org "{ADO_ORG_URL}" --project "{ADO_PROJECT}"
   ```
   Pick the one from the current half ({FISCAL_QUARTER}, {PRIOR_HALF}, etc.)
3. **Check sibling conventions**: Pull 2-3 existing items under the same parent.
   Read their descriptions. Match the style — don't invent a format.
   ```
   az boards query --wiql "SELECT [System.Id], [System.Title] FROM WorkItems
     WHERE [System.Parent] = {parent_id}
     AND [System.WorkItemType] = '{type}'
     AND [System.State] <> 'Removed'
     ORDER BY [System.CreatedDate] DESC" --org ...
   ```
   Then `az boards work-item show --id {sibling_id}` to read descriptions.
4. **Determine iteration**: Current sprint or next sprint.
   ```
   az boards iteration team list --team "{ADO_TEAM}" --project "{ADO_PROJECT}"
     --org "{ADO_ORG_URL}"
   ```

### Step 2: Draft

Present the draft to the user in a clean format:

```
WORK ITEM DRAFT — {type}
━━━━━━━━━━━━━━━━━━━━━━━━━
Title:       {title}
Type:        {Bug|User Story|Task|Feature}
Parent:      #{parent_id} — {parent_title}
Area:        {AREA_PATH}
Iteration:   {iteration path}
State:       New
Description: {description text}
{any other fields being set}
━━━━━━━━━━━━━━━━━━━━━━━━━
```

For updates, show before/after:
```
WORK ITEM UPDATE — #{id}
━━━━━━━━━━━━━━━━━━━━━━━━━
Field:   {field name}
Before:  {current value}
After:   {new value}
━━━━━━━━━━━━━━━━━━━━━━━━━
```

For deletes, show what's being removed and why.

**STOP HERE. Wait for explicit approval before proceeding.**

### Step 3: Execute

Only after the user approves:

1. **Create via REST API** (not CLI — CLI drops backslash paths):
   ```powershell
   $token = az account get-access-token --resource "{ADO_ORG_URL}" --query accessToken -o tsv 2>$null
   $url = "{ADO_ORG_URL}/{your-project}/_apis/wit/workitems/`${type_encoded}?api-version=7.0"

   $body = @(
       @{op="add"; path="/fields/System.Title"; value="..."}
       @{op="add"; path="/fields/System.AreaPath"; value="{AREA_PATH}"}
       @{op="add"; path="/fields/System.IterationPath"; value="..."}
       @{op="add"; path="/fields/System.Description"; value="..."}
   ) | ConvertTo-Json -Depth 3

   $resp = Invoke-RestMethod -Uri $url -Method Patch -Headers @{Authorization="Bearer $token"} -ContentType "application/json-patch+json" -Body $body
   ```
   Type encoding: `$Bug`, `$User%20Story`, `$Task`, `$Feature`

2. **Add parent link** (separate call):
   ```powershell
   az boards work-item relation add --id {parent_id} --relation-type Child --target-id {new_id} --org {ADO_ORG_URL}
   ```

3. **Verify**: `az boards work-item show --id {new_id} --expand relations` — confirm
   title, description, area, iteration, and parent link are all correct.

4. **Report**: Show the final work item ID and link.

## Team Conventions

### Bugs
- **Description field**: `System.Description` (never `ReproSteps`)
- **Style**: Plain prose. What's broken, what should happen. No template headers,
  no bolded section names, no structured format. Match sibling bugs.
- **Parent**: Current half Misc/Bugs feature unless the bug belongs to a specific feature.
- **No assignment**: Devs self-select. Leave unassigned unless the user specifies.

### User Stories
- **Description field**: `System.Description`
- **Style**: Plain prose for senior engineers. Skip "as a / I want / so that" if the
  overview already covers it. No code walkthroughs. Enough context to ask the right
  questions, not enough to avoid asking them.
- **No assignment**: Devs self-select.

### Features
- **Description field**: `System.Description`
- **Style**: Structured HTML specs (Requestors, Background, Scope, Impacts, Timeline,
  Risks, Out of Scope). These are specs, not blurbs. Never include a Stories table
  (stories are visible as child links).

### Tasks
- **Description field**: `System.Description`
- **Style**: Brief, actionable. What needs doing and any relevant context.

### All Types
- **Area Path**: `{AREA_PATH}` (default)
- **Tags**: Use `BLOCKED` tag for blocked items, not title text
- **Mermaid**: Does NOT render in ADO description fields. Use prose, tables, or ASCII.
- **Em dashes**: Use `&mdash;` in HTML, never raw `—` (corrupts in transit)

## Defaults

| Field | Default |
|-------|---------|
| Area Path | `{AREA_PATH}` |
| Org | `{ADO_ORG_URL}` |
| Project | `{ADO_PROJECT}` |
| State | `New` |
| Assigned To | (empty — devs self-select) |

## What This Skill Does NOT Do

- Query/read work items → use `ado-query` skill
- Bulk state transitions → use the appropriate ADO bulk-operation workflow or dedicated skill when available
- Sprint planning or triage → use the `sprint-planning` skill
