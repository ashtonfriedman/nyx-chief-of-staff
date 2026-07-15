# Dashboard Data Collector

## Purpose
Collects ADO work items from current and previous sprints, computes health metrics and velocity, and outputs a single JSON file for the team health dashboard.

## Usage

```powershell
python dashboard-collector.py
```

## Output
Writes to: `$env:OneDrive\Documents\agent-sync\dashboard-data.json`

## What It Does

1. **Queries ADO sprints**: Fetches all work items from:
   - Current sprint: Sprint-N
   - Previous sprint: Sprint-N

2. **Computes metrics**:
   - Velocity (by person and total, with trend analysis)
   - Health status for each work item based on age and type
   - Per-person workload and completion metrics

3. **Health Scoring Logic**:
   - Only scores items in "Active" state
   - Age calculated from ActivatedDate or CreatedDate
   - Thresholds vary by work item type:
     - **Tasks**: >5 days watch, >14 days warning, >28 days critical
     - **User Stories**: >14 days watch, >28 days warning, >42 days critical
     - **Bugs P1-P2**: >5 days watch, >14 days warning, >28 days critical
     - **Bugs P3+**: >14 days watch, >28 days warning, >42 days critical
     - **Features**: >42 days watch, >84 days warning, >126 days critical
   - New state items only flagged if >6 months (Tasks) or >1 year (Stories/Features)

4. **Velocity Calculation**:
   - Counts items in "Closed" or "Removed" state
   - Groups by assignee
   - Trend: >10% change = "up"/"down", otherwise "steady"

## JSON Output Structure

```json
{
  "generated": "ISO timestamp",
  "sprints": {
    "current": {
      "name": "Sprint-N",
      "startDate": "2026-03-08",
      "endDate": "2026-03-21",
      "items": [ ...full ADO work item objects... ]
    },
    "previous": {
      "name": "Sprint-N",
      "startDate": "2026-02-22",
      "endDate": "2026-03-07",
      "items": [ ...full ADO work item objects... ]
    }
  },
  "velocity": {
    "current": {
      "byPerson": {
        "Person Name": { "points": N, "items": N }
      },
      "total": { "points": N, "items": N }
    },
    "previous": { ...same structure... },
    "trend": "up|down|steady"
  },
  "health": {
    "summary": {
      "critical": N,
      "warning": N,
      "watch": N,
      "healthy": N
    },
    "items": [
      {
        "id": N,
        "title": "...",
        "type": "...",
        "state": "...",
        "assigned": "...",
        "storyPoints": N,
        "ageDays": N,
        "ageSprints": N,
        "healthStatus": "critical|warning|watch|healthy",
        "suggestion": "..." or null,
        "lastActivity": "ISO date"
      }
    ]
  },
  "byPerson": {
    "Person Name": {
      "currentItems": N,
      "currentPoints": N,
      "previousClosed": N,
      "previousPoints": N,
      "criticalCount": N,
      "warningCount": N
    }
  }
}
```

## Performance
- Fetches ~200-300 work items (depending on sprint size)
- Takes approximately 5-10 minutes to complete
- Progress logged to stderr every 20 items

## Requirements
- Python 3.7+
- Azure CLI installed at: `C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd`
- Authenticated to Azure DevOps with `az login`
- OneDrive environment variable set (for output path)

## Configuration
To update sprints or ADO settings, edit the constants at the top of the script:

```python
SPRINTS = {
    "current": {
        "name": "Sprint-N",
        "startDate": "2026-03-22",
        "endDate": "2026-04-04",
        "iterationPath": "{your-project}\\{your-team}\\FY00Q1\\Sprints\\Sprint-N"
    },
    "previous": {
        "name": "Sprint-N",
        "startDate": "2026-03-08",
        "endDate": "2026-03-21",
        "iterationPath": "{your-project}\\{your-team}\\FY00Q1\\Sprints\\Sprint-N"
    }
}
```

## Error Handling
- Gracefully handles empty sprints
- Strips control characters from ADO responses
- Continues on individual item fetch failures
- Exits with code 0 on success, 1 on fatal errors
- All progress/error messages printed to stderr to keep stdout clean
