#!/usr/bin/env python3
"""
Team Health Dashboard Data Collector
Collects ADO work items, computes metrics, outputs JSON for dashboard consumption.
"""

import json
import subprocess
import sys
import os
import re
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional


# Configuration
AZ_CLI = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
ORG_URL = "https://dev.azure.com/{your-org}"
PROJECT = "{your-project}"
AREA_PATH = "{your-project}\\{your-area-path}"

# Sprint definitions
SPRINTS = {
    "current": {
        "name": "Sprint-12",
        "startDate": "2026-03-08",
        "endDate": "2026-03-21",
        "iterationPath": "{your-project}\\{your-team}\\FY00Q1\\Sprints\\Sprint-Current"
    },
    "previous": {
        "name": "Sprint-11",
        "startDate": "2026-02-22",
        "endDate": "2026-03-07",
        "iterationPath": "{your-project}\\{your-team}\\FY00Q1\\Sprints\\Sprint-Previous"
    }
}

# Health scoring thresholds (in days)
HEALTH_THRESHOLDS = {
    "Task": {"watch": 5, "warning": 14, "critical": 28},
    "User Story": {"watch": 14, "warning": 28, "critical": 42},
    "Bug_P1_P2": {"watch": 5, "warning": 14, "critical": 28},
    "Bug_P3_Plus": {"watch": 14, "warning": 28, "critical": 42},
    "Feature": {"watch": 42, "warning": 84, "critical": 126},
}

NEW_STATE_THRESHOLDS = {
    "Task": 180,  # 6 months
    "User Story": 365,  # 1 year
    "Feature": 365,  # 1 year
}


def log(message: str) -> None:
    """Print to stderr to keep stdout clean."""
    print(message, file=sys.stderr)


def run_az_command(args: List[str]) -> Optional[Dict[str, Any]]:
    """Run az CLI command and return parsed JSON."""
    try:
        cmd = [AZ_CLI] + args
        log(f"Running: {' '.join(cmd)}")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace'
        )
        
        if result.returncode != 0:
            log(f"ERROR: Command failed with code {result.returncode}")
            log(f"STDERR: {result.stderr}")
            return None
        
        # Clean control characters that sometimes appear in ADO output
        cleaned = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', result.stdout)
        
        if not cleaned.strip():
            return []
        
        return json.loads(cleaned)
    
    except json.JSONDecodeError as e:
        log(f"ERROR: Failed to parse JSON: {e}")
        log(f"Output: {result.stdout[:500]}")
        return None
    except Exception as e:
        log(f"ERROR: Command execution failed: {e}")
        return None


def query_sprint_items(iteration_path: str) -> List[int]:
    """Query work item IDs for a sprint using WIQL."""
    # WIQL must be single line for az CLI
    wiql = f"SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] UNDER '{iteration_path}' AND [System.AreaPath] UNDER '{AREA_PATH}' ORDER BY [System.WorkItemType], [Microsoft.VSTS.Common.Priority]"
    
    log(f"Querying sprint: {iteration_path}")
    
    result = run_az_command([
        "boards", "query",
        "--wiql", wiql,
        "--org", ORG_URL,
        "--project", PROJECT,
        "-o", "json"
    ])
    
    if result is None:
        return []
    
    # Extract IDs from result - az boards query returns items with fields
    if isinstance(result, list):
        ids = []
        for item in result:
            # Try different ways to extract ID
            if "id" in item:
                ids.append(item["id"])
            elif "fields" in item and "System.Id" in item["fields"]:
                ids.append(item["fields"]["System.Id"])
        return ids
    
    return []


def fetch_work_items(ids: List[int]) -> List[Dict[str, Any]]:
    """Fetch full work item details one at a time (az CLI doesn't support batch)."""
    if not ids:
        return []
    
    all_items = []
    total = len(ids)
    
    for i, work_item_id in enumerate(ids, 1):
        if i % 20 == 0 or i == total:
            log(f"Fetching items: {i}/{total}")
        
        # Don't use -f fields parameter - just get all fields with expand=all (default)
        result = run_az_command([
            "boards", "work-item", "show",
            "--id", str(work_item_id),
            "--org", ORG_URL,
            "-o", "json"
        ])
        
        if result:
            all_items.append(result)
    
    return all_items


def parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """Parse ISO date string to datetime."""
    if not date_str:
        return None
    try:
        # Handle both with and without timezone
        if 'T' in date_str:
            date_str = date_str.split('.')[0]  # Remove microseconds
            date_str = date_str.replace('Z', '')
            return datetime.fromisoformat(date_str)
        return datetime.fromisoformat(date_str)
    except Exception:
        return None


def calculate_age_days(item: Dict[str, Any]) -> int:
    """Calculate age in days from ActivatedDate or CreatedDate."""
    fields = item.get("fields", {})
    activated = parse_date(fields.get("Microsoft.VSTS.Common.ActivatedDate"))
    created = parse_date(fields.get("System.CreatedDate"))
    
    start_date = activated or created
    if not start_date:
        return 0
    
    return (datetime.now() - start_date).days


def get_health_status(item: Dict[str, Any]) -> tuple[str, Optional[str]]:
    """
    Determine health status and suggestion for a work item.
    Returns (status, suggestion) where status is critical|warning|watch|healthy
    """
    fields = item.get("fields", {})
    state = fields.get("System.State", "")
    work_item_type = fields.get("System.WorkItemType", "")
    priority = fields.get("Microsoft.VSTS.Common.Priority", 3)
    
    # Only score Active items for aging
    if state != "Active":
        # Check New state items
        if state == "New":
            age_days = calculate_age_days(item)
            threshold = NEW_STATE_THRESHOLDS.get(work_item_type, 365)
            
            if age_days > threshold:
                return "warning", f"In New state for {age_days} days - needs triage"
        
        return "healthy", None
    
    age_days = calculate_age_days(item)
    
    # Determine thresholds based on type
    if work_item_type == "Bug":
        if priority in [1, 2]:
            thresholds = HEALTH_THRESHOLDS["Bug_P1_P2"]
        else:
            thresholds = HEALTH_THRESHOLDS["Bug_P3_Plus"]
    else:
        thresholds = HEALTH_THRESHOLDS.get(work_item_type, HEALTH_THRESHOLDS["Task"])
    
    # Determine status
    if age_days >= thresholds["critical"]:
        return "critical", f"Active for {age_days} days - needs immediate attention"
    elif age_days >= thresholds["warning"]:
        return "warning", f"Active for {age_days} days - review progress"
    elif age_days >= thresholds["watch"]:
        return "watch", f"Active for {age_days} days"
    
    return "healthy", None


def calculate_velocity(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate velocity metrics for closed items."""
    by_person = {}
    total_points = 0
    total_items = 0
    
    for item in items:
        fields = item.get("fields", {})
        state = fields.get("System.State", "")
        
        # Only count Closed or Removed items
        if state not in ["Closed", "Removed"]:
            continue
        
        assigned_to = fields.get("System.AssignedTo", {})
        person_name = assigned_to.get("displayName", "Unassigned") if isinstance(assigned_to, dict) else "Unassigned"
        story_points = fields.get("Microsoft.VSTS.Scheduling.StoryPoints", 0) or 0
        
        if person_name not in by_person:
            by_person[person_name] = {"points": 0, "items": 0}
        
        by_person[person_name]["points"] += story_points
        by_person[person_name]["items"] += 1
        total_points += story_points
        total_items += 1
    
    return {
        "byPerson": by_person,
        "total": {"points": total_points, "items": total_items}
    }


def calculate_by_person_metrics(current_items: List[Dict[str, Any]], 
                                previous_items: List[Dict[str, Any]],
                                health_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Calculate per-person metrics."""
    by_person = {}
    
    # Current sprint items
    for item in current_items:
        fields = item.get("fields", {})
        assigned_to = fields.get("System.AssignedTo", {})
        person_name = assigned_to.get("displayName", "Unassigned") if isinstance(assigned_to, dict) else "Unassigned"
        story_points = fields.get("Microsoft.VSTS.Scheduling.StoryPoints", 0) or 0
        
        if person_name not in by_person:
            by_person[person_name] = {
                "currentItems": 0,
                "currentPoints": 0,
                "previousClosed": 0,
                "previousPoints": 0,
                "criticalCount": 0,
                "warningCount": 0
            }
        
        by_person[person_name]["currentItems"] += 1
        by_person[person_name]["currentPoints"] += story_points
    
    # Previous sprint closed items
    for item in previous_items:
        fields = item.get("fields", {})
        state = fields.get("System.State", "")
        
        if state not in ["Closed", "Removed"]:
            continue
        
        assigned_to = fields.get("System.AssignedTo", {})
        person_name = assigned_to.get("displayName", "Unassigned") if isinstance(assigned_to, dict) else "Unassigned"
        story_points = fields.get("Microsoft.VSTS.Scheduling.StoryPoints", 0) or 0
        
        if person_name not in by_person:
            by_person[person_name] = {
                "currentItems": 0,
                "currentPoints": 0,
                "previousClosed": 0,
                "previousPoints": 0,
                "criticalCount": 0,
                "warningCount": 0
            }
        
        by_person[person_name]["previousClosed"] += 1
        by_person[person_name]["previousPoints"] += story_points
    
    # Health counts
    for item in health_items:
        if item["healthStatus"] in ["critical", "warning"]:
            person_name = item.get("assigned", "Unassigned")
            
            if person_name not in by_person:
                by_person[person_name] = {
                    "currentItems": 0,
                    "currentPoints": 0,
                    "previousClosed": 0,
                    "previousPoints": 0,
                    "criticalCount": 0,
                    "warningCount": 0
                }
            
            if item["healthStatus"] == "critical":
                by_person[person_name]["criticalCount"] += 1
            else:
                by_person[person_name]["warningCount"] += 1
    
    return by_person


def process_sprint_data(sprint_key: str) -> Dict[str, Any]:
    """Collect and process data for a sprint."""
    sprint_config = SPRINTS[sprint_key]
    
    log(f"\n=== Processing {sprint_config['name']} ===")
    
    # Query work item IDs
    ids = query_sprint_items(sprint_config["iterationPath"])
    log(f"Found {len(ids)} work items")
    
    if not ids:
        return {
            "name": sprint_config["name"],
            "startDate": sprint_config["startDate"],
            "endDate": sprint_config["endDate"],
            "items": []
        }
    
    # Fetch full details
    items = fetch_work_items(ids)
    log(f"Fetched {len(items)} work item details")
    
    return {
        "name": sprint_config["name"],
        "startDate": sprint_config["startDate"],
        "endDate": sprint_config["endDate"],
        "items": items
    }


def build_health_items(current_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Build health item summaries."""
    health_items = []
    
    for item in current_items:
        fields = item.get("fields", {})
        
        work_item_id = fields.get("System.Id", item.get("id", 0))
        title = fields.get("System.Title", "")
        work_item_type = fields.get("System.WorkItemType", "")
        state = fields.get("System.State", "")
        assigned_to = fields.get("System.AssignedTo", {})
        assigned_name = assigned_to.get("displayName", "Unassigned") if isinstance(assigned_to, dict) else "Unassigned"
        story_points = fields.get("Microsoft.VSTS.Scheduling.StoryPoints", 0) or 0
        
        age_days = calculate_age_days(item)
        age_sprints = round(age_days / 14, 1)  # 2-week sprints
        
        health_status, suggestion = get_health_status(item)
        
        # Determine last activity date
        state_change = parse_date(fields.get("Microsoft.VSTS.Common.StateChangeDate"))
        last_activity = state_change.isoformat() if state_change else None
        
        health_items.append({
            "id": work_item_id,
            "title": title,
            "type": work_item_type,
            "state": state,
            "assigned": assigned_name,
            "storyPoints": story_points,
            "ageDays": age_days,
            "ageSprints": age_sprints,
            "healthStatus": health_status,
            "suggestion": suggestion,
            "lastActivity": last_activity
        })
    
    return health_items


def main():
    """Main execution."""
    log("Starting dashboard data collection...")
    
    # Collect data for both sprints
    current_data = process_sprint_data("current")
    previous_data = process_sprint_data("previous")
    
    # Calculate velocity
    log("\n=== Calculating velocity ===")
    current_velocity = calculate_velocity(current_data["items"])
    previous_velocity = calculate_velocity(previous_data["items"])
    
    # Determine trend
    current_points = current_velocity["total"]["points"]
    previous_points = previous_velocity["total"]["points"]
    
    if previous_points > 0:
        change_pct = ((current_points - previous_points) / previous_points) * 100
        if change_pct > 10:
            trend = "up"
        elif change_pct < -10:
            trend = "down"
        else:
            trend = "steady"
    else:
        trend = "steady"
    
    # Calculate health
    log("\n=== Calculating health metrics ===")
    health_items = build_health_items(current_data["items"])
    
    health_summary = {
        "critical": len([i for i in health_items if i["healthStatus"] == "critical"]),
        "warning": len([i for i in health_items if i["healthStatus"] == "warning"]),
        "watch": len([i for i in health_items if i["healthStatus"] == "watch"]),
        "healthy": len([i for i in health_items if i["healthStatus"] == "healthy"])
    }
    
    # Calculate by-person metrics
    log("\n=== Calculating by-person metrics ===")
    by_person = calculate_by_person_metrics(
        current_data["items"],
        previous_data["items"],
        health_items
    )
    
    # Build output structure
    output = {
        "generated": datetime.now().isoformat(),
        "sprints": {
            "current": current_data,
            "previous": previous_data
        },
        "velocity": {
            "current": current_velocity,
            "previous": previous_velocity,
            "trend": trend
        },
        "health": {
            "summary": health_summary,
            "items": health_items
        },
        "byPerson": by_person
    }
    
    # Write to output file
    onedrive = os.environ.get('OneDrive')
    if not onedrive:
        log("ERROR: OneDrive environment variable not set")
        return 1
    
    output_path = os.path.join(onedrive, "Documents", "agent-sync", "dashboard-data.json")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    log(f"\n=== Writing output to {output_path} ===")
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    log(f"✓ Successfully wrote {len(current_data['items'])} current + {len(previous_data['items'])} previous items")
    log(f"✓ Health: {health_summary['critical']} critical, {health_summary['warning']} warning")
    log(f"✓ Velocity trend: {trend}")
    
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"FATAL ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
