"""
Feature Progress Skill — Sprint Calendar
ADO iteration fetch, sprint date resolution, elapsed/remaining calculations.

Covers: FR-08, EC-05, EC-10
"""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, date, timezone

from constants import AZ_CMD, ORG, PROJECT, TEAM_NAME, PERIOD_ITERATIONS, PERIOD_TOTAL_SPRINTS
from log_utils import log, sanitize_err


@dataclass
class Sprint:
    path: str
    start_date: date | None
    end_date: date | None
    name: str = ""

    def __post_init__(self):
        if not self.name and self.path:
            self.name = self.path.rsplit("\\", 1)[-1]


@dataclass
class SprintCalendar:
    sprints: list[Sprint] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def period_start(self) -> date | None:
        dated = [s for s in self.sprints if s.start_date]
        return min(s.start_date for s in dated) if dated else None

    @property
    def period_end(self) -> date | None:
        dated = [s for s in self.sprints if s.end_date]
        return max(s.end_date for s in dated) if dated else None

    def get_current_sprint(self, ref_date: date | None = None) -> Sprint | None:
        today = ref_date or date.today()
        for s in self.sprints:
            if s.start_date and s.end_date and s.start_date <= today <= s.end_date:
                return s
        return None

    def sprints_elapsed(self, since_date: date | None = None, ref_date: date | None = None) -> int:
        """Count sprints elapsed since a date. Current sprint counts as elapsed (EC-10)."""
        today = ref_date or date.today()
        start = since_date or self.period_start
        if not start:
            return 0
        count = 0
        for s in self.sprints:
            if s.start_date and s.start_date <= today:
                if since_date is None or s.start_date >= start or (s.end_date and s.end_date >= start):
                    count += 1
        return count

    def sprints_remaining(self, ref_date: date | None = None) -> int:
        total = len(self.sprints) if self.sprints else PERIOD_TOTAL_SPRINTS
        elapsed = self.sprints_elapsed(ref_date=ref_date)
        return max(0, total - elapsed)

    def sprint_for_date(self, dt: date) -> Sprint | None:
        for s in self.sprints:
            if s.start_date and s.end_date and s.start_date <= dt <= s.end_date:
                return s
        return None

    def sprint_n_from_now(self, n: int, ref_date: date | None = None) -> Sprint | None:
        """Get the sprint that is N sprints from now (into the future)."""
        today = ref_date or date.today()
        future_sprints = [
            s for s in self.sprints
            if s.start_date and s.start_date > today
        ]
        future_sprints.sort(key=lambda s: s.start_date)
        if 0 < n <= len(future_sprints):
            return future_sprints[n - 1]
        return None

    def get_sprint_by_index_from_end(self, n_from_end: int) -> Sprint | None:
        """Get sprint N positions from the end of period."""
        if not self.sprints or n_from_end < 1 or n_from_end > len(self.sprints):
            return None
        return self.sprints[-n_from_end]


def _fetch_iterations_for_root(iteration_root: str) -> list[dict]:
    """Fetch iterations under a root path via az CLI."""
    try:
        result = subprocess.run(
            [AZ_CMD, "boards", "iteration", "team", "list",
             "--team", TEAM_NAME,
             "--org", ORG,
             "--project", PROJECT,
             "-o", "json"],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            log(f"Iteration fetch failed: {sanitize_err(result.stderr)}")
            return []
        data = json.loads(result.stdout, strict=False)
        if isinstance(data, list):
            return data
        return data.get("value", data.get("children", []))
    except Exception as e:
        log(f"Iteration fetch exception: {sanitize_err(str(e))}")
        return []


def _parse_date(date_str: str | None) -> date | None:
    if not date_str:
        return None
    try:
        # ADO returns ISO 8601 dates like "2026-04-07T00:00:00Z"
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).date()
    except (ValueError, TypeError):
        return None


def build_calendar() -> SprintCalendar:
    """Build the sprint calendar by querying ADO iteration data."""
    calendar = SprintCalendar()
    seen_paths = set()

    raw_iterations = _fetch_iterations_for_root("all")

    for item in raw_iterations:
        path = item.get("path", "")
        # Filter to period iteration trees only
        is_period = any(path.startswith(root) or path == root for root in PERIOD_ITERATIONS)
        if not is_period:
            continue

        if path in seen_paths:
            continue
        seen_paths.add(path)

        attrs = item.get("attributes", {})
        start = _parse_date(attrs.get("startDate"))
        end = _parse_date(attrs.get("finishDate"))

        if not start and not end:
            # This is likely a parent node, not a leaf sprint
            continue

        if start and end and start > end:
            calendar.warnings.append(
                f"Sprint gap detected in iteration data — using available boundaries"
            )
            continue

        sprint = Sprint(path=path, start_date=start, end_date=end)
        calendar.sprints.append(sprint)

    # Sort by start date
    calendar.sprints.sort(key=lambda s: s.start_date or date.max)

    # Detect gaps between consecutive sprints
    for i in range(1, len(calendar.sprints)):
        prev = calendar.sprints[i - 1]
        curr = calendar.sprints[i]
        if prev.end_date and curr.start_date:
            gap_days = (curr.start_date - prev.end_date).days
            if gap_days > 3:  # Allow for weekends
                calendar.warnings.append(
                    "Sprint gap detected in iteration data — using available boundaries"
                )

    if not calendar.sprints:
        calendar.warnings.append("No sprint iterations found for period")

    return calendar
