"""
Feature Progress Skill — Period Summary
FP committed/done/remaining, sprints elapsed/remaining, simple projection.

Covers: FR-06, FR-07
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from state_classifier import StateBucket, ClassificationResult
from sprint_calendar import SprintCalendar
from log_utils import log


class PeriodStatus(Enum):
    ON_PACE = "On Pace"
    AT_RISK = "At Risk"
    BEHIND = "Behind"
    INSUFFICIENT_DATA = "Insufficient Data"


@dataclass
class ZeroProgressAlert:
    feature_id: int
    title_raw: str
    fp: float | None
    alert_type: str  # "no_children" or "all_not_started"
    latest_start_sprint: str = ""
    latest_start_date: str = ""
    can_complete: bool = True


@dataclass
class PeriodSummary:
    fp_committed: float = 0.0
    fp_completed: float = 0.0
    fp_remaining: float = 0.0
    features_with_fp: int = 0
    features_without_fp: int = 0
    sprints_elapsed: int = 0
    sprints_remaining: int = 0
    projection: float = 0.0
    projection_available: bool = False
    status: PeriodStatus = PeriodStatus.INSUFFICIENT_DATA
    status_emoji: str = "⚪"
    zero_progress_alerts: list[ZeroProgressAlert] = field(default_factory=list)


def compute_summary(
    features: list,
    classifications: dict[int, ClassificationResult],
    calendar: SprintCalendar,
) -> PeriodSummary:
    """Compute period-level progress summary."""
    summary = PeriodSummary()

    # Compute FP totals (exclude null-FP features from calculation, EC-01)
    for feature in features:
        fid = feature.id
        cls = classifications.get(fid)
        if cls and cls.bucket == StateBucket.REMOVED:
            continue

        if feature.fp is not None and feature.fp > 0:
            summary.fp_committed += feature.fp
            summary.features_with_fp += 1
            if cls and cls.bucket == StateBucket.COMPLETE:
                summary.fp_completed += feature.fp
        else:
            summary.features_without_fp += 1

    summary.fp_remaining = summary.fp_committed - summary.fp_completed

    # Sprint counts
    summary.sprints_elapsed = calendar.sprints_elapsed()
    summary.sprints_remaining = calendar.sprints_remaining()

    # Simple projection (FR-06)
    if summary.sprints_elapsed > 0 and summary.fp_committed > 0:
        rate = summary.fp_completed / summary.sprints_elapsed
        summary.projection = summary.fp_completed + (rate * summary.sprints_remaining)
        summary.projection_available = True

        # Thresholds
        ratio = summary.projection / summary.fp_committed if summary.fp_committed > 0 else 0
        if ratio >= 1.0:
            summary.status = PeriodStatus.ON_PACE
            summary.status_emoji = "🟢"
        elif ratio >= 0.8:
            summary.status = PeriodStatus.AT_RISK
            summary.status_emoji = "🟡"
        else:
            summary.status = PeriodStatus.BEHIND
            summary.status_emoji = "🔴"
    else:
        summary.projection_available = False
        summary.status = PeriodStatus.INSUFFICIENT_DATA
        summary.status_emoji = "⚪"

    return summary


def compute_zero_progress_alerts(
    features: list,
    classifications: dict[int, ClassificationResult],
    children_map: dict,
    calendar: SprintCalendar,
) -> list[ZeroProgressAlert]:
    """Identify features with zero progress (FR-07)."""
    alerts = []

    for feature in features:
        fid = feature.id
        cls = classifications.get(fid)
        if not cls or cls.bucket not in (StateBucket.NOT_STARTED,):
            continue

        fc = children_map.get(fid)
        child_count = len(fc.children) if fc else 0

        if child_count == 0:
            alert_type = "no_children"
        else:
            alert_type = "all_not_started"

        alert = ZeroProgressAlert(
            feature_id=fid,
            title_raw=feature.title_raw,
            fp=feature.fp,
            alert_type=alert_type,
        )

        # Compute latest-start date (FR-07)
        if feature.fp is not None and feature.fp > 0:
            sprints_needed = int(feature.fp)
            sprints_remaining = calendar.sprints_remaining()

            if sprints_needed > sprints_remaining:
                alert.can_complete = False
                alert.latest_start_sprint = (
                    "This feature cannot complete on time at standard velocity"
                )
            else:
                # Latest start = sprints_remaining - sprints_needed sprints from now
                slack = sprints_remaining - sprints_needed
                if slack <= 0:
                    alert.can_complete = False
                    alert.latest_start_sprint = (
                        "This feature cannot complete on time at standard velocity"
                    )
                else:
                    target_sprint = calendar.sprint_n_from_now(slack)
                    if target_sprint:
                        start_str = ""
                        if target_sprint.start_date:
                            start_str = target_sprint.start_date.isoformat()
                        alert.latest_start_sprint = (
                            f"Must start by {target_sprint.name} ({start_str}) to finish on time"
                        )
                        alert.latest_start_date = start_str
                    else:
                        alert.latest_start_sprint = (
                            f"This feature is {int(feature.fp)} FP — "
                            f"{sprints_remaining} sprints remain"
                        )
        else:
            alert.latest_start_sprint = "Feature has no FP estimate — cannot compute latest start"

        alerts.append(alert)

    return alerts
