"""
Feature Progress Skill — Pace Classifier
Per-feature pace classification using ActivatedDate and FP.

Covers: FR-05, US-07, EC-01
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum

from constants import STATE_CATEGORIES
from metrics import MetricsResult
from sprint_calendar import SprintCalendar


class PaceStatus(Enum):
    ON_PACE = "On Pace"
    AT_RISK = "At Risk"
    BEHIND = "Behind"
    SUPPRESSED = "Suppressed"


@dataclass
class PaceResult:
    status: PaceStatus = PaceStatus.SUPPRESSED
    suppressed: bool = False
    reason: str = ""
    expected_pct: float = 0.0
    actual_pct: float = 0.0
    used_story_count: bool = False  # True if pace used story count due to low SP coverage


def classify_pace(
    feature_fp: float | None,
    children: list,
    metrics_result,
    calendar: SprintCalendar,
    ref_date: date | None = None,
) -> PaceResult:
    """Classify a feature's delivery pace.

    Args:
        feature_fp: Feature points (effort field)
        children: List of child records with activated_date attribute
        metrics_result: MetricsResult with completion percentages and coverage flags
        calendar: Sprint calendar for elapsed computation
        ref_date: Reference date (defaults to today)
    """
    result = PaceResult()

    if metrics_result.data_unavailable:
        result.suppressed = True
        result.reason = "Data unavailable"
        return result

    # EC-01: No FP → suppress pace
    if feature_fp is None or feature_fp <= 0:
        result.suppressed = True
        result.reason = "Feature has no FP estimate — cannot track pace"
        return result

    # Find earliest ActivatedDate among non-removed children
    activated_dates = []
    for child in children:
        cat = STATE_CATEGORIES.get(child.state_raw, "in_progress")
        if cat != "removed" and child.activated_date is not None:
            activated_dates.append(child.activated_date)

    if not activated_dates:
        # US-07: No ActivatedDate → suppress pace
        result.suppressed = True
        result.reason = "Pace unavailable — no activation date found"
        return result

    earliest_activation = min(activated_dates)

    # Calculate sprints elapsed since work started
    sprints_elapsed = calendar.sprints_elapsed(
        since_date=earliest_activation, ref_date=ref_date
    )
    if sprints_elapsed <= 0:
        sprints_elapsed = 1  # At least 1 if work has started

    # Expected completion: sprints elapsed / FP (= expected sprints)
    expected_pct = min(100.0, (sprints_elapsed / feature_fp) * 100)
    result.expected_pct = expected_pct

    # Actual completion: use SP if reliable, story count if low coverage
    if metrics_result.low_sp_coverage:
        actual_pct = metrics_result.story_completion_pct
        result.used_story_count = True
    else:
        actual_pct = metrics_result.sp_completion_pct
    result.actual_pct = actual_pct

    # Classify pace
    if actual_pct >= expected_pct:
        result.status = PaceStatus.ON_PACE
    elif actual_pct >= expected_pct * 0.5:
        result.status = PaceStatus.AT_RISK
    else:
        result.status = PaceStatus.BEHIND

    return result


def classify_all_pace(
    features: list,
    children_map: dict,
    metrics_map: dict,
    calendar: SprintCalendar,
) -> dict[int, PaceResult]:
    """Classify pace for all features."""
    results = {}
    for feature in features:
        fid = feature.id
        fc = children_map.get(fid)
        child_list = fc.children if fc else []
        mr = metrics_map.get(fid)
        if mr is None:
            mr = MetricsResult()
        results[fid] = classify_pace(
            feature_fp=feature.fp,
            children=child_list,
            metrics_result=mr,
            calendar=calendar,
        )
    return results
