"""
Feature Progress Skill — Child Fetcher
Retrieves child work items (User Stories, Bugs) via Hierarchy-Forward relations.
Extracts ActivatedDate, displayName-only for assigned-to (SEC-02).

Covers: FR-02, SEC-02, NFR-03, EC-07
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, date

from ado_client import fetch_with_relations, fetch_batch
from log_utils import log, sanitize_err
from security_utils import validate_id


@dataclass
class ChildRecord:
    id: int
    type: str
    state_raw: str
    sp: float | None  # None = missing, 0 = explicitly zero (EC-07)
    activated_date: date | None
    assigned_display_name: str
    tags_raw: str
    title_raw: str = ""
    is_blocked: bool = False


@dataclass
class FeatureChildren:
    feature_id: int
    children: list[ChildRecord] = field(default_factory=list)
    data_unavailable: bool = False
    error_message: str = ""


def _parse_date(date_str: str | None) -> date | None:
    if not date_str:
        return None
    try:
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


def _extract_child(item: dict) -> ChildRecord | None:
    """Extract a ChildRecord from a work item dict."""
    f = item.get("fields", {})
    raw_id = f.get("System.Id") or item.get("id")
    validated = validate_id(raw_id)
    if validated is None:
        return None

    # Extract displayName only from AssignedTo (SEC-02)
    assigned = ""
    a = f.get("System.AssignedTo")
    if a and isinstance(a, dict):
        assigned = a.get("displayName", "")
    elif a and isinstance(a, str):
        assigned = a

    # SP: distinguish null from 0 (EC-07)
    sp_raw = f.get("Microsoft.VSTS.Scheduling.StoryPoints")
    sp = None
    if sp_raw is not None:
        try:
            sp = float(sp_raw)
        except (ValueError, TypeError):
            sp = None

    tags_raw = str(f.get("System.Tags", "") or "")
    is_blocked = "BLOCKED" in {t.strip() for t in tags_raw.split(";") if t.strip()}

    return ChildRecord(
        id=validated,
        title_raw=str(f.get("System.Title", "")).strip(),
        type=str(f.get("System.WorkItemType", "")),
        state_raw=str(f.get("System.State", "")),
        sp=sp,
        activated_date=_parse_date(f.get("Microsoft.VSTS.Common.ActivatedDate")),
        assigned_display_name=assigned if assigned else "Unassigned",
        tags_raw=tags_raw,
        is_blocked=is_blocked,
    )


def _get_child_ids_from_relations(item: dict) -> list[int]:
    """Extract child work item IDs from Hierarchy-Forward relations."""
    relations = item.get("relations", [])
    child_ids = []
    for rel in relations:
        if rel.get("rel") == "System.LinkTypes.Hierarchy-Forward":
            url = rel.get("url", "")
            # URL format: https://.../_apis/wit/workItems/12345
            parts = url.rstrip("/").split("/")
            if parts:
                validated = validate_id(parts[-1])
                if validated is not None:
                    child_ids.append(validated)
    return child_ids


def fetch_children_for_feature(feature_id: int) -> FeatureChildren:
    """Fetch all child work items for a single feature."""
    result = FeatureChildren(feature_id=feature_id)

    try:
        parent_item = fetch_with_relations(feature_id)
        if parent_item is None:
            result.data_unavailable = True
            result.error_message = f"data unavailable for feature {feature_id}"
            return result

        child_ids = _get_child_ids_from_relations(parent_item)
        if not child_ids:
            return result

        # Deduplicate child IDs
        child_ids = list(set(child_ids))

        # Batch fetch children
        child_items = fetch_batch(child_ids)

        seen_ids = set()
        for item in child_items:
            child = _extract_child(item)
            if child and child.id not in seen_ids:
                seen_ids.add(child.id)
                result.children.append(child)

    except Exception as e:
        log(f"Child fetch failed for feature {feature_id}: {sanitize_err(str(e))}")
        result.data_unavailable = True
        result.error_message = f"data unavailable for feature {feature_id}"

    return result


def fetch_all_children(
    feature_ids: list[int],
) -> dict[int, FeatureChildren]:
    """Fetch children for all features. Per-feature failure isolation (NFR-03)."""
    results = {}
    total = len(feature_ids)
    for i, fid in enumerate(feature_ids):
        log(f"Fetching children for feature {i + 1}/{total}...")
        results[fid] = fetch_children_for_feature(fid)
    return results
