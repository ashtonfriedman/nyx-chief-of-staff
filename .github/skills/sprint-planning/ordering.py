"""
Backlog ordering logic for sprint-planning skill (FR-010, FR-011).

Sets StackRank on features and their child items to enforce the team's
ordering convention.
"""

import sys
from typing import Any

try:
    from sprint_planning.ado_client import AdoClient, AdoConflictError
    from sprint_planning.analyzer import WorkItem
    from sprint_planning.audit import AuditLog
    from sprint_planning.mutations import revalidate_item, MutationResult
    from sprint_planning.preflight import MISC_BUGS_ID, URGENT_BUGS_ID
except ImportError:
    from ado_client import AdoClient, AdoConflictError
    from analyzer import WorkItem
    from audit import AuditLog
    from mutations import revalidate_item, MutationResult
    from preflight import MISC_BUGS_ID, URGENT_BUGS_ID


STACK_RANK_BASE = 1000.0
STACK_RANK_INCREMENT = 100.0


def compute_feature_order(
    feature_summaries: list[dict],
    all_items: list[WorkItem],
) -> list[dict]:
    """Determine the feature ordering per FR-010.

    Order:
    1. Urgent Bugs feature (10000043) — first
    2. Misc/Bugs feature (10000042) — second
    3. Features with children in sprint, by total SP descending
    4. All other features — last
    """
    pinned = {URGENT_BUGS_ID: 0, MISC_BUGS_ID: 1}
    features_with_children = []
    features_without_children = []

    for fs in feature_summaries:
        fid = fs["id"]
        if fid in pinned:
            continue
        if fs["child_count"] > 0:
            features_with_children.append(fs)
        else:
            features_without_children.append(fs)

    # Sort by total SP descending
    features_with_children.sort(key=lambda f: f["total_sp"], reverse=True)

    ordered = []
    rank = STACK_RANK_BASE

    # 1. Urgent Bugs
    ordered.append({"id": URGENT_BUGS_ID, "rank": rank, "label": "Urgent Bugs"})
    rank += STACK_RANK_INCREMENT

    # 2. Misc/Bugs
    ordered.append({"id": MISC_BUGS_ID, "rank": rank, "label": "Misc/Bugs"})
    rank += STACK_RANK_INCREMENT

    # 3. Features with children (by SP desc)
    for fs in features_with_children:
        ordered.append({
            "id": fs["id"], "rank": rank,
            "label": fs.get("title", f"Feature #{fs['id']}"),
        })
        rank += STACK_RANK_INCREMENT

    # 4. Features without children — last (EC-07)
    for fs in features_without_children:
        ordered.append({
            "id": fs["id"], "rank": rank,
            "label": fs.get("title", f"Feature #{fs['id']}"),
        })
        rank += STACK_RANK_INCREMENT

    return ordered


def compute_item_order(
    feature_order: list[dict],
    feature_summaries: list[dict],
) -> list[dict]:
    """Determine item-level ordering within feature groups (FR-011).

    Items within each feature are ordered sequentially.
    """
    fs_map = {fs["id"]: fs for fs in feature_summaries}
    item_ranks = []
    rank = STACK_RANK_BASE

    for fo in feature_order:
        fid = fo["id"]
        fs = fs_map.get(fid)
        if not fs or "children" not in fs:
            continue
        children = fs["children"]
        # Order: by priority ASC, then by story points DESC
        sorted_children = sorted(
            children,
            key=lambda c: (c.priority, -(c.story_points or 0)),
        )
        for child in sorted_children:
            item_ranks.append({
                "id": child.id,
                "rank": rank,
                "current_rank": None,  # Filled during execution
                "revision": child.revision,
            })
            rank += STACK_RANK_INCREMENT / 10  # Finer grain for items

    return item_ranks


def execute_ordering(
    client: AdoClient,
    feature_order: list[dict],
    item_order: list[dict],
    audit: AuditLog,
) -> MutationResult:
    """Execute StackRank updates for features and items (FR-010, FR-011).

    Uses pre-write revalidation for each item. No approval gate needed
    (ordering is deterministic and easily reversed).
    """
    result = MutationResult()

    # Features
    print("\n📊 Setting feature StackRank...", file=sys.stderr)
    for fo in feature_order:
        _set_stack_rank(client, fo["id"], fo["rank"], audit, result)

    # Items
    if item_order:
        print("📊 Setting item StackRank...", file=sys.stderr)
        for io in item_order:
            _set_stack_rank(client, io["id"], io["rank"], audit, result)

    return result


def _set_stack_rank(
    client: AdoClient,
    item_id: int,
    target_rank: float,
    audit: AuditLog,
    result: MutationResult,
):
    """Set StackRank on a single item with revalidation."""
    try:
        current = client.get_work_item(item_id)
    except Exception:
        result.skipped.append({"id": item_id, "reason": "Could not fetch for revalidation"})
        return

    if not current or "fields" not in current:
        result.skipped.append({"id": item_id, "reason": "No data returned"})
        return

    current_rank = current["fields"].get("Microsoft.VSTS.Common.StackRank")
    rev = current.get("rev", 0)

    # Idempotency: skip if already at target rank (within tolerance)
    if current_rank is not None and abs(current_rank - target_rank) < 0.01:
        result.skipped.append({"id": item_id, "reason": "StackRank already correct"})
        return

    operations = [
        {
            "op": "replace",
            "path": "/fields/Microsoft.VSTS.Common.StackRank",
            "value": target_rank,
        }
    ]

    try:
        client.patch_work_item(item_id, operations, revision=rev)
        result.succeeded.append({"id": item_id, "title": f"StackRank → {target_rank}"})
        audit.log("set_stack_rank", item_id, "StackRank",
                   str(current_rank), str(target_rank))
    except AdoConflictError:
        result.skipped.append({"id": item_id, "reason": "Revision conflict"})
        audit.log_error("set_stack_rank", item_id, 412, "Revision conflict")
    except Exception as e:
        result.failed.append({"id": item_id, "error": str(e)[:200]})
        audit.log_error("set_stack_rank", item_id, None, str(e)[:200])
