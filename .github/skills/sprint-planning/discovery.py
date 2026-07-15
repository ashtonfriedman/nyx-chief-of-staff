"""
Sprint discovery via ADO team iteration schedule (FR-001).

Identifies the current and next sprint by comparing iteration date ranges
against today's date.
"""

import sys
from datetime import date, datetime
from typing import NamedTuple


class SprintInfo(NamedTuple):
    name: str
    path: str
    start_date: date
    end_date: date


class SprintPair(NamedTuple):
    current: SprintInfo
    next_sprint: SprintInfo


def discover_sprints(client) -> SprintPair:
    """Query team iterations and identify current + next sprint.

    Raises SystemExit on EC-01 (sprint not found).
    """
    iterations = client.get_team_iterations()
    if not iterations:
        print("❌ No iterations found for team. Check ADO iteration configuration.", file=sys.stderr)
        sys.exit(1)

    today = date.today()
    sprints = []

    for it in iterations:
        attrs = it.get("attributes", {})
        start_str = attrs.get("startDate")
        end_str = attrs.get("finishDate")
        if not start_str or not end_str:
            continue
        try:
            start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00")).date()
            end_dt = datetime.fromisoformat(end_str.replace("Z", "+00:00")).date()
        except (ValueError, TypeError):
            continue

        sprints.append(SprintInfo(
            name=it.get("name", ""),
            path=it.get("path", ""),
            start_date=start_dt,
            end_date=end_dt,
        ))

    # Sort by start date
    sprints.sort(key=lambda s: s.start_date)

    # Find current sprint (contains today)
    current = None
    current_idx = -1
    for i, s in enumerate(sprints):
        if s.start_date <= today <= s.end_date:
            current = s
            current_idx = i
            break

    if current is None:
        # Fallback: find the most recent past sprint
        past = [s for s in sprints if s.end_date < today]
        if past:
            current = past[-1]
            current_idx = sprints.index(current)
        else:
            print(
                "❌ Cannot determine current sprint. No iteration contains today's date "
                f"({today.isoformat()}). Check the team's iteration schedule in ADO.",
                file=sys.stderr,
            )
            sys.exit(1)

    # Find next sprint
    if current_idx + 1 < len(sprints):
        next_sprint = sprints[current_idx + 1]
    else:
        print(
            f"❌ Found current sprint ({current.name}) but no next sprint exists. "
            "The iteration schedule may not have a future sprint configured.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Current sprint: {current.name} ({current.path})", file=sys.stderr)
    print(f"  Dates: {current.start_date} to {current.end_date}", file=sys.stderr)
    print(f"Next sprint: {next_sprint.name} ({next_sprint.path})", file=sys.stderr)
    print(f"  Dates: {next_sprint.start_date} to {next_sprint.end_date}", file=sys.stderr)

    return SprintPair(current=current, next_sprint=next_sprint)
