"""
Read-side analysis for sprint-planning skill.

Covers: FR-002 (query), FR-003/FR-003A (carryover), FR-006 (hierarchy scan),
FR-008 (orphan detection), FR-009 (bug SP), FR-012 (load analysis),
FR-013 (feature summary), FR-014/FR-015 (flags), FR-022 (idempotency).
"""

import html
import sys
from dataclasses import dataclass, field
from typing import Any

try:
    from sprint_planning.wiql_builder import WiqlBuilder, validate_item_id
    from sprint_planning.preflight import MISC_BUGS_ID, URGENT_BUGS_ID, AREA_PREFIX
except ImportError:
    from wiql_builder import WiqlBuilder, validate_item_id
    from preflight import MISC_BUGS_ID, URGENT_BUGS_ID, AREA_PREFIX

DEFAULT_VELOCITY = 36


@dataclass
class WorkItem:
    id: int
    work_item_type: str
    state: str
    assigned_to: str
    story_points: float | None
    parent_id: int | None
    title: str
    tags: str
    priority: int
    iteration_path: str
    effort: float | None = None
    revision: int = 0
    area_path: str = ""
    relations: list = field(default_factory=list)

    @classmethod
    def from_ado(cls, item: dict) -> "WorkItem":
        f = item.get("fields", {})
        assigned = ""
        a = f.get("System.AssignedTo")
        if a and isinstance(a, dict):
            assigned = a.get("displayName", "")
        elif a and isinstance(a, str):
            assigned = a

        parent_id = f.get("System.Parent")
        if parent_id:
            try:
                parent_id = validate_item_id(parent_id)
            except ValueError:
                parent_id = None

        return cls(
            id=f.get("System.Id", 0) or item.get("id", 0),
            work_item_type=f.get("System.WorkItemType", ""),
            state=f.get("System.State", ""),
            assigned_to=assigned,
            story_points=f.get("Microsoft.VSTS.Scheduling.StoryPoints"),
            parent_id=parent_id,
            title=str(f.get("System.Title", "")).strip(),
            tags=str(f.get("System.Tags", "") or ""),
            priority=f.get("Microsoft.VSTS.Common.Priority", 4),
            iteration_path=f.get("System.IterationPath", ""),
            effort=f.get("Microsoft.VSTS.Scheduling.Effort"),
            revision=item.get("rev", 0),
            area_path=f.get("System.AreaPath", ""),
            relations=item.get("relations", []) or [],
        )


@dataclass
class CarryoverCandidate:
    item: WorkItem
    reason: str
    hierarchy_split: bool = False
    parent_sprint: str = ""
    parent_item: WorkItem | None = None


@dataclass
class HierarchyViolation:
    child: WorkItem
    parent: WorkItem
    grandparent_id: int | None = None
    reparent_target_id: int = MISC_BUGS_ID
    is_circular: bool = False


@dataclass
class SprintAnalysis:
    current_items: list[WorkItem] = field(default_factory=list)
    next_items: list[WorkItem] = field(default_factory=list)
    carryover_candidates: list[CarryoverCandidate] = field(default_factory=list)
    hierarchy_violations: list[HierarchyViolation] = field(default_factory=list)
    orphaned_items: list[WorkItem] = field(default_factory=list)
    uncosted_bugs: list[WorkItem] = field(default_factory=list)
    active_unassigned: list[WorkItem] = field(default_factory=list)
    blocked_items: list[WorkItem] = field(default_factory=list)
    uncosted_next: list[WorkItem] = field(default_factory=list)
    total_sp_next: float = 0
    sp_by_assignee: dict[str, float] = field(default_factory=dict)
    is_overloaded: bool = False
    velocity_delta: float = 0
    velocity_pct: float = 0
    feature_summaries: list[dict] = field(default_factory=list)
    icm_items: list[WorkItem] = field(default_factory=list)
    tag_iteration_mismatches: list[dict] = field(default_factory=list)


def query_sprint_items(client, iteration_path: str) -> list[WorkItem]:
    """Query all non-Closed/Removed work items in a sprint iteration (FR-002)."""
    wiql = (
        WiqlBuilder()
        .where_iteration_eq(iteration_path)
        .where_area_under(AREA_PREFIX)
        .where_states_not_in(["Closed", "Removed"])
        .where_types(["User Story", "Bug", "Task"])
        .order_by("System.WorkItemType")
        .order_by("Microsoft.VSTS.Common.Priority")
        .build()
    )
    ids = client.query_wiql(wiql)
    if not ids:
        return []

    raw_items = client.get_work_items_batch(ids)
    items = []
    for raw in raw_items:
        try:
            wi = WorkItem.from_ado(raw)
            if wi.state not in ("Closed", "Removed"):
                items.append(wi)
        except Exception as e:
            print(f"  Warning: skipping malformed work item: {e}", file=sys.stderr)
    return items


def identify_carryover(
    current_items: list[WorkItem],
    next_iteration_path: str,
    all_current_ids: set[int] | None = None,
) -> tuple[list[CarryoverCandidate], list[WorkItem]]:
    """Identify carryover candidates from current sprint (FR-003, FR-003A, EC-10).

    Returns (candidates, active_unassigned).
    """
    candidates = []
    active_unassigned = []

    if all_current_ids is None:
        all_current_ids = {wi.id for wi in current_items}

    # Build parent lookup
    parent_items = {wi.id: wi for wi in current_items}

    for wi in current_items:
        # EC-03: Already in next sprint — skip
        if wi.iteration_path == next_iteration_path:
            continue

        # EC-10: Active + unassigned is an anomaly, not a carryover candidate
        if wi.state == "Active" and not wi.assigned_to:
            active_unassigned.append(wi)
            continue

        # Carryover: New state OR unassigned (not Active/Resolved/Committed)
        is_candidate = False
        reason = ""
        if wi.state == "New":
            is_candidate = True
            reason = "State is New"
        elif not wi.assigned_to and wi.state not in ("Active", "Resolved", "Committed"):
            is_candidate = True
            reason = "Unassigned"

        if not is_candidate:
            continue

        # FR-003A: hierarchy split detection
        hierarchy_split = False
        parent_sprint = ""
        parent_item = None
        if wi.parent_id and wi.parent_id in all_current_ids:
            parent = parent_items.get(wi.parent_id)
            if parent and parent.state not in ("New",) and parent.assigned_to:
                # Parent is staying (Active/Resolved/Committed), child would move
                hierarchy_split = True
                parent_sprint = "current"
                parent_item = parent

        candidates.append(CarryoverCandidate(
            item=wi,
            reason=reason,
            hierarchy_split=hierarchy_split,
            parent_sprint=parent_sprint,
            parent_item=parent_item,
        ))

    return candidates, active_unassigned


def scan_hierarchy_violations(
    items: list[WorkItem],
    client=None,
) -> list[HierarchyViolation]:
    """Scan for same-category parent-child violations (FR-006).

    A violation is when parent and child are the same work item type
    (Bug→Bug, Story→Story, Task→Task).
    """
    violations = []
    item_map = {wi.id: wi for wi in items}

    # Track visited to detect cycles (EC-04)
    for wi in items:
        if not wi.parent_id:
            continue

        parent = item_map.get(wi.parent_id)
        if parent is None and client is not None:
            # Cross-area ancestor resolution (FR-007): read-only, one level only
            try:
                raw = client.get_work_item(wi.parent_id)
                if raw and "fields" in raw:
                    parent = WorkItem.from_ado(raw)
            except Exception:
                pass

        if parent is None:
            continue

        if parent.work_item_type == wi.work_item_type:
            # Same-category violation found
            grandparent_id = parent.parent_id
            reparent_target = MISC_BUGS_ID

            if grandparent_id:
                # Check grandparent accessibility and state
                gp = item_map.get(grandparent_id)
                if gp is None and client is not None:
                    try:
                        raw = client.get_work_item(grandparent_id)
                        if raw and "fields" in raw:
                            gp = WorkItem.from_ado(raw)
                    except Exception:
                        gp = None

                if gp:
                    # EC-05: grandparent must not be Closed/Removed
                    # FR-007: grandparent must be under the configured area path
                    if (
                        gp.state not in ("Closed", "Removed")
                        and gp.area_path.startswith(AREA_PREFIX)
                    ):
                        reparent_target = grandparent_id
                    # else: fall back to Misc/Bugs

            # EC-04: Circular hierarchy check (A→B→A)
            is_circular = False
            if parent.parent_id == wi.id:
                is_circular = True

            violations.append(HierarchyViolation(
                child=wi,
                parent=parent,
                grandparent_id=grandparent_id,
                reparent_target_id=reparent_target,
                is_circular=is_circular,
            ))

    return violations


def find_orphans(items: list[WorkItem]) -> list[WorkItem]:
    """Find items with no parent link (FR-008)."""
    return [wi for wi in items if not wi.parent_id]


def find_uncosted_bugs(items: list[WorkItem]) -> list[WorkItem]:
    """Find bugs with no story points (FR-009)."""
    return [
        wi for wi in items
        if wi.work_item_type == "Bug"
        and (wi.story_points is None or wi.story_points == 0)
    ]


def analyze_load(
    items: list[WorkItem],
    velocity: int = DEFAULT_VELOCITY,
) -> dict:
    """Analyze next sprint load vs velocity (FR-012)."""
    total_sp = sum(wi.story_points or 0 for wi in items)
    sp_by_assignee: dict[str, float] = {}
    for wi in items:
        name = wi.assigned_to or "Unassigned"
        sp_by_assignee[name] = sp_by_assignee.get(name, 0) + (wi.story_points or 0)

    delta = total_sp - velocity
    pct = (delta / velocity * 100) if velocity > 0 else 0

    return {
        "total_sp": total_sp,
        "sp_by_assignee": sp_by_assignee,
        "is_overloaded": total_sp > velocity,
        "velocity_delta": delta,
        "velocity_pct": pct,
        "velocity": velocity,
    }


def build_feature_summaries(
    items: list[WorkItem],
    client=None,
) -> list[dict]:
    """Build per-feature summaries for next sprint items (FR-013).

    Feature identification via iteration path (canonical).
    """
    # Group items by parent_id
    by_parent: dict[int, list[WorkItem]] = {}
    for wi in items:
        if wi.parent_id:
            by_parent.setdefault(wi.parent_id, []).append(wi)

    summaries = []
    seen_features = set()

    for parent_id, children in by_parent.items():
        if parent_id in seen_features:
            continue
        seen_features.add(parent_id)

        total_sp = sum(c.story_points or 0 for c in children)
        feature_title = f"Feature #{parent_id}"
        feature_effort = None

        # Try to fetch feature details
        if client:
            try:
                raw = client.get_work_item(parent_id)
                if raw and "fields" in raw:
                    f = raw["fields"]
                    feature_title = str(f.get("System.Title", f"Feature #{parent_id}")).strip()
                    feature_effort = f.get("Microsoft.VSTS.Scheduling.Effort")
            except Exception:
                pass

        summaries.append({
            "id": parent_id,
            "title": feature_title,
            "total_sp": total_sp,
            "effort": feature_effort,
            "child_count": len(children),
            "children": children,
        })

    # Sort by total SP descending
    summaries.sort(key=lambda s: s["total_sp"], reverse=True)
    return summaries


def find_blocked_items(items: list[WorkItem]) -> list[WorkItem]:
    """Find blocked items (FR-014)."""
    blocked = []
    for wi in items:
        if wi.state == "Blocked":
            blocked.append(wi)
        elif wi.tags and "blocked" in wi.tags.lower():
            blocked.append(wi)
    return blocked


def find_uncosted_items(items: list[WorkItem]) -> list[WorkItem]:
    """Find stories and bugs with no story points in next sprint (FR-015)."""
    return [
        wi for wi in items
        if wi.work_item_type in ("User Story", "Bug")
        and (wi.story_points is None or wi.story_points == 0)
    ]


def find_icm_items(items: list[WorkItem]) -> list[WorkItem]:
    """Find items with incident-related tags (FR-019)."""
    icm_keywords = ["icm", "incident", "sev1", "sev2", "livesite", "hotfix"]
    result = []
    for wi in items:
        if wi.tags:
            tags_lower = wi.tags.lower()
            if any(kw in tags_lower for kw in icm_keywords):
                result.append(wi)
    return result


def run_full_analysis(client, current_path: str, next_path: str, velocity: int = DEFAULT_VELOCITY) -> SprintAnalysis:
    """Execute the full read-side analysis pipeline (NFR-002: all reads before writes)."""
    print("\n📊 Querying current sprint items...", file=sys.stderr)
    current_items = query_sprint_items(client, current_path)
    print(f"  Found {len(current_items)} items in current sprint", file=sys.stderr)

    print("📊 Querying next sprint items...", file=sys.stderr)
    next_items = query_sprint_items(client, next_path)
    print(f"  Found {len(next_items)} items in next sprint", file=sys.stderr)

    all_items = current_items + next_items
    all_ids = {wi.id for wi in all_items}

    print("🔍 Identifying carryover candidates...", file=sys.stderr)
    candidates, active_unassigned = identify_carryover(
        current_items, next_path, all_ids
    )
    print(f"  {len(candidates)} carryover candidates, {len(active_unassigned)} active-unassigned", file=sys.stderr)

    print("🔍 Scanning hierarchy violations...", file=sys.stderr)
    violations = scan_hierarchy_violations(all_items, client)
    print(f"  {len(violations)} hierarchy violations found", file=sys.stderr)

    print("🔍 Finding orphaned items...", file=sys.stderr)
    orphans = find_orphans(all_items)
    print(f"  {len(orphans)} orphaned items", file=sys.stderr)

    print("🔍 Finding uncosted bugs...", file=sys.stderr)
    uncosted = find_uncosted_bugs(all_items)
    print(f"  {len(uncosted)} uncosted bugs", file=sys.stderr)

    print("📊 Analyzing next sprint load...", file=sys.stderr)
    load = analyze_load(next_items, velocity)

    print("📊 Building feature summaries...", file=sys.stderr)
    features = build_feature_summaries(next_items, client)

    print("🔍 Finding blocked and uncosted items...", file=sys.stderr)
    blocked = find_blocked_items(next_items)
    uncosted_next = find_uncosted_items(next_items)
    icm = find_icm_items(next_items)

    return SprintAnalysis(
        current_items=current_items,
        next_items=next_items,
        carryover_candidates=candidates,
        hierarchy_violations=violations,
        orphaned_items=orphans,
        uncosted_bugs=uncosted,
        active_unassigned=active_unassigned,
        blocked_items=blocked,
        uncosted_next=uncosted_next,
        total_sp_next=load["total_sp"],
        sp_by_assignee=load["sp_by_assignee"],
        is_overloaded=load["is_overloaded"],
        velocity_delta=load["velocity_delta"],
        velocity_pct=load["velocity_pct"],
        feature_summaries=features,
        icm_items=icm,
    )
