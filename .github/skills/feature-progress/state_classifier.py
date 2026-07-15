"""
Feature Progress Skill — State Classifier
Category-based feature state classification with BLOCKED overlay.

Covers: FR-03, EC-02, EC-11
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from constants import STATE_CATEGORIES
from log_utils import log


class StateBucket(Enum):
    NOT_STARTED = "Not Started"
    IN_PROGRESS = "In Progress"
    COMPLETE = "Complete"
    REMOVED = "Removed"


@dataclass
class ClassificationResult:
    bucket: StateBucket
    blocked_overlay: bool = False
    is_unscoped: bool = False
    all_removed_flag: bool = False  # EC-02
    warnings: list[str] = field(default_factory=list)


def _categorize_state(state: str, work_item_id: int | None = None) -> str:
    """Map a work item state to a category. Unknown states → in_progress with warning."""
    category = STATE_CATEGORIES.get(state)
    if category is None:
        if work_item_id is not None:
            log(f"Unknown state '{state}' on work item {work_item_id} — treated as in-progress")
        return "in_progress"
    return category


def classify_feature(
    feature_state: str,
    feature_fp: float | None,
    children: list,
    feature_id: int | None = None,
) -> ClassificationResult:
    """Classify a feature into a state bucket based on its children.

    Args:
        feature_state: The feature's own workflow state
        feature_fp: Feature points (effort) — used for unscoped detection
        children: List of child records with state_raw, tags_raw, is_blocked attributes
        feature_id: For logging context
    """
    result = ClassificationResult(bucket=StateBucket.NOT_STARTED)

    # Check if feature itself is removed
    feature_category = _categorize_state(feature_state, feature_id)
    if feature_category == "removed":
        result.bucket = StateBucket.REMOVED
        return result

    # Filter to non-Removed children
    non_removed = []
    for child in children:
        cat = _categorize_state(child.state_raw, getattr(child, "id", None))
        if cat != "removed":
            non_removed.append((child, cat))

    # No non-Removed children
    if not non_removed:
        result.bucket = StateBucket.NOT_STARTED
        if not children:
            # Truly no children at all
            if feature_fp is None:
                result.is_unscoped = True
        else:
            # All children are removed (EC-02)
            result.bucket = StateBucket.COMPLETE
            result.all_removed_flag = True
            result.warnings.append(
                "All stories removed — feature may have been descoped rather than delivered"
            )
        return result

    # Check state categories of non-removed children
    categories = [cat for _, cat in non_removed]
    all_complete = all(c == "complete" for c in categories)
    any_in_progress = any(c == "in_progress" for c in categories)
    any_complete = any(c == "complete" for c in categories)

    if all_complete:
        result.bucket = StateBucket.COMPLETE
    elif any_in_progress or any_complete:
        result.bucket = StateBucket.IN_PROGRESS
    else:
        result.bucket = StateBucket.NOT_STARTED

    # BLOCKED overlay: any non-Removed child tagged BLOCKED
    for child, _ in non_removed:
        if getattr(child, "is_blocked", False):
            result.blocked_overlay = True
            break

    return result


def classify_all(
    features: list,
    children_map: dict,
) -> dict[int, ClassificationResult]:
    """Classify all features."""
    results = {}
    for feature in features:
        fid = feature.id
        fc = children_map.get(fid)
        child_list = fc.children if fc else []
        results[fid] = classify_feature(
            feature_state=feature.state_raw,
            feature_fp=feature.fp,
            children=child_list,
            feature_id=fid,
        )
    return results
