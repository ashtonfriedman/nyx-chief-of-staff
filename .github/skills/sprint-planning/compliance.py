"""
Compliance item handling for sprint-planning (FR-016).

When the user identifies items as Compliance, the skill:
- Validates IDs against loaded sprint data
- Proposes: unassign, reparent to the compliance backlog, confirm area path
- Executes with approval gate and pre-write revalidation
"""

import sys
from typing import Any

try:
    from sprint_planning.ado_client import AdoClient, AdoConflictError
    from sprint_planning.analyzer import WorkItem
    from sprint_planning.audit import AuditLog
    from sprint_planning.mutations import request_approval, revalidate_item, MutationResult
    from sprint_planning.preflight import COMPLIANCE_BACKLOG_ID, AREA_PREFIX
    from sprint_planning.wiql_builder import validate_item_id
except ImportError:
    from ado_client import AdoClient, AdoConflictError
    from analyzer import WorkItem
    from audit import AuditLog
    from mutations import request_approval, revalidate_item, MutationResult
    from preflight import COMPLIANCE_BACKLOG_ID, AREA_PREFIX
    from wiql_builder import validate_item_id


def get_compliance_ids_from_user(loaded_ids: set[int]) -> list[int]:
    """Prompt user for Compliance item IDs and validate against loaded data.

    Returns validated list of IDs, or empty list if user skips.
    Rejects IDs not in the loaded sprint data (R2-SEC CRITICAL-003).
    """
    print(
        "\nEnter Compliance item IDs (comma-separated), or 'skip' to continue:",
        file=sys.stderr,
    )
    try:
        response = input("> ").strip()
    except (EOFError, KeyboardInterrupt):
        return []

    if response.lower() == "skip" or not response:
        return []

    validated = []
    for part in response.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            item_id = validate_item_id(part)
        except ValueError:
            print(f"  ⚠ '{part}' is not a valid work item ID — rejected.", file=sys.stderr)
            continue

        if item_id not in loaded_ids:
            print(
                f"  ⚠ ID {item_id} not found in loaded sprint data — rejected. "
                "Supply only IDs visible in the current or next sprint.",
                file=sys.stderr,
            )
            continue
        validated.append(item_id)

    return validated


def execute_compliance(
    client: AdoClient,
    item_ids: list[int],
    items_map: dict[int, WorkItem],
    audit: AuditLog,
) -> MutationResult:
    """Execute Compliance handling: unassign, reparent, confirm area path (FR-016)."""
    result = MutationResult()

    for item_id in item_ids:
        wi = items_map.get(item_id)
        if not wi:
            result.skipped.append({"id": item_id, "reason": "Item not in loaded data"})
            continue

        # Pre-write revalidation
        valid, current = revalidate_item(client, item_id, wi.revision)
        if not valid:
            result.skipped.append({
                "id": item_id, "reason": "Modified since proposal — skipped",
            })
            audit.log("compliance", item_id, status="skipped",
                       detail="Pre-write revalidation failed")
            continue

        rev = current.get("rev", wi.revision) if current else wi.revision

        operations = []

        # Unassign
        operations.append({
            "op": "replace",
            "path": "/fields/System.AssignedTo",
            "value": "",
        })

        # reparent to the compliance backlog
        operations.append({
            "op": "replace",
            "path": "/fields/System.Parent",
            "value": str(COMPLIANCE_BACKLOG_ID),
        })

        # Ensure area path matches the configured area prefix
        if wi.area_path != AREA_PREFIX:
            operations.append({
                "op": "replace",
                "path": "/fields/System.AreaPath",
                "value": AREA_PREFIX,
            })

        try:
            client.patch_work_item(item_id, operations, revision=rev)
            result.succeeded.append({"id": item_id, "title": wi.title})
            audit.log("compliance_unassign", item_id, "AssignedTo",
                       wi.assigned_to, "")
            audit.log("compliance_reparent", item_id, "Parent",
                       str(wi.parent_id), str(COMPLIANCE_BACKLOG_ID))
        except AdoConflictError:
            result.skipped.append({"id": item_id, "reason": "Revision conflict"})
            audit.log_error("compliance", item_id, 412, "Revision conflict")
        except Exception as e:
            result.failed.append({"id": item_id, "error": str(e)[:200]})
            audit.log_error("compliance", item_id, None, str(e)[:200])

    return result
