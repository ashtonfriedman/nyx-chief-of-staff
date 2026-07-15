---
name: ado-query
description: Query ADO work items with configurable filters. Use when you need sprint contents, backlog views, feature breakdowns, or any structured ADO query. Replaces ad-hoc WIQL + az CLI + Python parsing pipelines.
---

# ADO Query Skill

## Purpose

Structured ADO work item querying with clean output. Eliminates the repeated pattern of
building WIQL, calling az CLI, parsing broken JSON, and formatting results.

## Tool

```
python .github/skills/ado-query/query.py [options]
```

## Common Invocations

### Sprint contents (grouped by type)
```powershell
python .github/skills/ado-query/query.py --iteration "{ADO_PROJECT}\{PRIOR_HALF}\{half}\Sprint\Sprint-13" --group-by type
```

### Sprint contents (only user stories and bugs)
```powershell
python .github/skills/ado-query/query.py --iteration "..." --types "User Story,Bug"
```

### Items under a specific feature
```powershell
python .github/skills/ado-query/query.py --parent 10000001
```

### TeamTag-tagged items in a half
```powershell
python .github/skills/ado-query/query.py --iteration "{ADO_PROJECT}\{PRIOR_HALF}" --tags "TeamTag"
```

### Unassigned work in a sprint
```powershell
python .github/skills/ado-query/query.py --iteration "..." --assigned unassigned
```

### JSON output for downstream processing
```powershell
python .github/skills/ado-query/query.py --iteration "..." --output json
```

### Just IDs (for piping to other tools)
```powershell
python .github/skills/ado-query/query.py --iteration "..." --output ids
```

### Raw WIQL override
```powershell
python .github/skills/ado-query/query.py --wiql "SELECT [System.Id] FROM WorkItems WHERE ..."
```

## Parameters

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--iteration` | `-i` | Iteration path (UNDER match) | required* |
| `--area` | `-a` | Area path (UNDER match) | `{AREA_PATH}` |
| `--states` | `-s` | Comma-separated states, `!` prefix to exclude | `NOT IN (Closed, Removed)` |
| `--types` | `-t` | Comma-separated work item types | all |
| `--tags` | | Comma-separated tags (AND match) | none |
| `--parent` | `-p` | Parent work item ID | none |
| `--assigned` | | AssignedTo contains match, or `unassigned` | none |
| `--group-by` | `-g` | `type`, `parent`, `assigned`, `none` | `type` |
| `--output` | `-o` | `table`, `json`, `ids` | `table` |
| `--wiql` | | Raw WIQL (skips query builder) | none |
| `--org` | | ADO org URL | `{ADO_ORG_URL}` |
| `--project` | | ADO project | `{ADO_PROJECT}` |

*At least `--iteration`, `--parent`, or `--wiql` is required.

## Output Formats

- **table**: Grouped human-readable table with ID, type, state, priority, cost (FP/SP), assigned, title, tags
- **json**: Array of normalized records (id, type, state, priority, title, tags, assigned, parent, iteration, effort, storyPoints)
- **ids**: One ID per line, for piping

### Cost Fields

Features use **effort** (`Microsoft.VSTS.Scheduling.Effort`) measured in sprints (1 FP = 1 sprint for 1 dev).
Stories/Bugs use **storyPoints** (`Microsoft.VSTS.Scheduling.StoryPoints`) measured in dev-days.
Table output shows `FP` for effort and `SP` for story points. JSON output includes both fields on every record.

## Notes

- WIQL query via `az boards`, then batch REST API fetch for full details (up to 200 per request).
  Falls back to individual `az boards work-item show` calls if REST fails.
- Uses UTF-8 BOM stripping on REST responses (ADO returns BOM inconsistently).
- Progress updates print to stderr.
- The `--states` flag defaults to excluding Closed and Removed. Use `--states "New,Active"` to
  be explicit, or `--states "!Closed"` to exclude just one.
