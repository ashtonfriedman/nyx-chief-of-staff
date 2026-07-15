"""
Feature Progress Skill — Metrics
Story count %, SP %, SP coverage, low-coverage detection.

Covers: FR-04, EC-07
"""

from __future__ import annotations

from dataclasses import dataclass

from constants import STATE_CATEGORIES
from log_utils import log


@dataclass
class MetricsResult:
    # Story count
    total_stories: int = 0
    done_stories: int = 0
    story_completion_pct: float = 0.0

    # Story points
    total_sp: float = 0.0
    done_sp: float = 0.0
    sp_completion_pct: float = 0.0

    # Coverage
    stories_with_sp: int = 0
    sp_coverage_pct: float = 0.0
    low_sp_coverage: bool = False
    sp_reliable: bool = True

    # Data availability
    data_unavailable: bool = False


def _is_complete(state: str) -> bool:
    return STATE_CATEGORIES.get(state, "in_progress") == "complete"


def _is_removed(state: str) -> bool:
    return STATE_CATEGORIES.get(state, "in_progress") == "removed"


def compute_metrics(children: list) -> MetricsResult:
    """Compute completion metrics for a feature's children.

    Args:
        children: List of child records with state_raw and sp attributes
    """
    result = MetricsResult()

    # Filter out removed children
    non_removed = [c for c in children if not _is_removed(c.state_raw)]

    if not non_removed:
        return result

    result.total_stories = len(non_removed)

    # Story count completion
    result.done_stories = sum(1 for c in non_removed if _is_complete(c.state_raw))
    result.story_completion_pct = (
        result.done_stories / result.total_stories * 100 if result.total_stories > 0 else 0.0
    )

    # SP metrics
    total_sp = 0.0
    done_sp = 0.0
    has_sp_count = 0

    for child in non_removed:
        if child.sp is not None:  # SP=0 counts as estimated (EC-07), None does not
            has_sp_count += 1
            total_sp += child.sp
            if _is_complete(child.state_raw):
                done_sp += child.sp
        else:
            # Null SP: still count in done_stories but not in SP
            pass

    result.total_sp = total_sp
    result.done_sp = done_sp
    result.sp_completion_pct = (done_sp / total_sp * 100) if total_sp > 0 else 0.0

    # SP coverage
    result.stories_with_sp = has_sp_count
    result.sp_coverage_pct = (
        has_sp_count / result.total_stories * 100 if result.total_stories > 0 else 0.0
    )

    # Low coverage threshold: < 50%
    result.low_sp_coverage = result.sp_coverage_pct < 50.0
    result.sp_reliable = not result.low_sp_coverage

    return result


def compute_all(
    features: list,
    children_map: dict,
) -> dict[int, MetricsResult]:
    """Compute metrics for all features."""
    results = {}
    for feature in features:
        fid = feature.id
        fc = children_map.get(fid)
        if fc and fc.data_unavailable:
            results[fid] = MetricsResult(data_unavailable=True)
        elif fc:
            results[fid] = compute_metrics(fc.children)
        else:
            results[fid] = MetricsResult()
    return results
