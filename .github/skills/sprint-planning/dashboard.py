"""
HTML dashboard rendering for sprint-planning skill.

Renders the sprint planning dashboard using Jinja2 with autoescape=True.
All ADO-sourced values are additionally passed through html.escape() for
defense-in-depth (SEC-007).
"""

import html
import os
import sys
from typing import Any

try:
    import jinja2
except ImportError:  # optional dependency — checked lazily at render time
    jinja2 = None

try:
    from sprint_planning.analyzer import SprintAnalysis, WorkItem
except ImportError:
    from analyzer import SprintAnalysis, WorkItem


TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")


def _esc(value) -> str:
    """Defense-in-depth HTML escaping for all ADO-sourced strings."""
    if value is None:
        return ""
    return html.escape(str(value))


def _build_state_summary(items: list[WorkItem]) -> dict[str, int]:
    """Count items by state."""
    counts: dict[str, int] = {}
    for wi in items:
        state = wi.state or "Unknown"
        counts[state] = counts.get(state, 0) + 1
    return counts


def _build_assignee_load(items: list[WorkItem]) -> list[dict]:
    """Build assignee SP load for bar chart."""
    sp_map: dict[str, float] = {}
    for wi in items:
        name = wi.assigned_to or "Unassigned"
        sp_map[name] = sp_map.get(name, 0) + (wi.story_points or 0)
    max_sp = max(sp_map.values()) if sp_map else 1
    return [
        {"name": _esc(name), "sp": sp, "pct": min(100, int(sp / max_sp * 100)) if max_sp > 0 else 0}
        for name, sp in sorted(sp_map.items(), key=lambda x: -x[1])
    ]


def _build_item_rows(items: list[WorkItem]) -> list[dict]:
    """Build table rows with all values escaped."""
    return [
        {
            "id": wi.id,
            "type": _esc(wi.work_item_type),
            "state": _esc(wi.state),
            "priority": wi.priority,
            "sp": wi.story_points or 0,
            "assigned": _esc(wi.assigned_to),
            "title": _esc(wi.title),
            "tags": _esc(wi.tags),
        }
        for wi in items
    ]


def _build_feature_cards(summaries: list[dict]) -> list[dict]:
    """Build feature card data with escaped values."""
    return [
        {
            "id": fs["id"],
            "title": _esc(fs["title"]),
            "sp": fs["total_sp"],
            "effort": fs.get("effort"),
            "child_count": fs["child_count"],
        }
        for fs in summaries
    ]


def _build_warnings(analysis: SprintAnalysis, velocity: int) -> list[dict]:
    """Build warning items for the warnings section."""
    warnings = []

    if analysis.is_overloaded:
        warnings.append({
            "level": "critical",
            "icon": "🔴",
            "message": (
                f"Sprint overloaded: {analysis.total_sp_next:.0f} SP loaded vs "
                f"{velocity} SP velocity ({analysis.velocity_delta:+.0f} SP, "
                f"{analysis.velocity_pct:+.0f}%)"
            ),
        })

    for wi in analysis.blocked_items:
        warnings.append({
            "level": "high",
            "icon": "🚫",
            "message": f"Blocked: #{wi.id} {_esc(wi.title)}",
        })

    for wi in analysis.active_unassigned:
        warnings.append({
            "level": "medium",
            "icon": "⚠️",
            "message": f"Active but unassigned — needs owner: #{wi.id} {_esc(wi.title)}",
        })

    for wi in analysis.uncosted_next:
        warnings.append({
            "level": "low",
            "icon": "💲",
            "message": f"No story points: #{wi.id} {_esc(wi.title)} ({_esc(wi.work_item_type)})",
        })

    for wi in analysis.icm_items:
        warnings.append({
            "level": "medium",
            "icon": "🔥",
            "message": f"ICM/Incident: #{wi.id} {_esc(wi.title)}",
        })

    return warnings


def _build_talking_points(analysis: SprintAnalysis, velocity: int) -> list[str]:
    """Generate talking points from structured data only (SEC-009).

    Derived exclusively from counts, SP totals, item IDs — never from
    work item title/tag/description text content.
    """
    points = []

    # Carryover summary
    n_carry = len(analysis.carryover_candidates)
    if n_carry > 0:
        points.append(
            f"{n_carry} items identified as carryover candidates "
            f"(New state or unassigned in current sprint)."
        )
    else:
        points.append("No carryover candidates — all current sprint items are in progress or assigned.")

    # Hierarchy fixes
    n_violations = len(analysis.hierarchy_violations)
    if n_violations > 0:
        points.append(f"{n_violations} same-category hierarchy violations detected and queued for remediation.")

    # Orphans
    n_orphans = len(analysis.orphaned_items)
    if n_orphans > 0:
        points.append(f"{n_orphans} orphaned items (no parent) — will be reparented under Misc/Bugs.")

    # Uncosted bugs
    n_uncosted = len(analysis.uncosted_bugs)
    if n_uncosted > 0:
        points.append(f"{n_uncosted} bugs without story points — will be set to 1 SP minimum.")

    # Load analysis
    sp = analysis.total_sp_next
    if sp > 0:
        if analysis.is_overloaded:
            points.append(
                f"Next sprint is overloaded: {sp:.0f} SP vs {velocity} SP velocity "
                f"({analysis.velocity_delta:+.0f} SP, {analysis.velocity_pct:+.0f}%). "
                "Consider deferring or splitting work."
            )
        else:
            points.append(
                f"Next sprint load: {sp:.0f} SP vs {velocity} SP velocity "
                f"({analysis.velocity_delta:+.0f} SP, {analysis.velocity_pct:+.0f}%). "
                "Within capacity."
            )
    else:
        points.append(
            "Next sprint contains only carryover — no pre-planned work. "
            "Sprint backlog needs population."
        )

    # Blockers
    n_blocked = len(analysis.blocked_items)
    if n_blocked > 0:
        blocked_ids = ", ".join(f"#{wi.id}" for wi in analysis.blocked_items[:5])
        points.append(f"{n_blocked} blocked items in next sprint: {blocked_ids}")

    # Active unassigned
    n_unassigned = len(analysis.active_unassigned)
    if n_unassigned > 0:
        points.append(f"{n_unassigned} items are Active but unassigned — need owners assigned.")

    # Features
    n_features = len(analysis.feature_summaries)
    if n_features > 0:
        points.append(f"{n_features} features have work planned in the next sprint.")

    return points


def render_dashboard(
    analysis: SprintAnalysis,
    current_sprint_name: str,
    next_sprint_name: str,
    velocity: int = 36,
    mutation_summary: dict | None = None,
) -> str:
    """Render the sprint planning dashboard HTML.

    Uses Jinja2 with autoescape=True. All ADO values pre-escaped via _esc().
    """
    if jinja2 is None:
        raise RuntimeError(
            "Jinja2 is required to render the dashboard. "
            "Install it with: pip install jinja2"
        )
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(TEMPLATE_DIR),
        autoescape=True,
    )
    template = env.get_template("sprint_planning.html.j2")

    ctx = {
        "current_sprint_name": _esc(current_sprint_name),
        "next_sprint_name": _esc(next_sprint_name),
        "velocity": velocity,
        # Current sprint
        "current_state_summary": _build_state_summary(analysis.current_items),
        "current_assignee_load": _build_assignee_load(analysis.current_items),
        "current_items": _build_item_rows(analysis.current_items),
        "current_item_count": len(analysis.current_items),
        # Next sprint
        "next_items": _build_item_rows(analysis.next_items),
        "next_item_count": len(analysis.next_items),
        "next_sp_total": analysis.total_sp_next,
        "sp_by_assignee": [
            {"name": _esc(n), "sp": sp}
            for n, sp in sorted(analysis.sp_by_assignee.items(), key=lambda x: -x[1])
        ],
        "is_overloaded": analysis.is_overloaded,
        "velocity_delta": analysis.velocity_delta,
        "velocity_pct": analysis.velocity_pct,
        "feature_cards": _build_feature_cards(analysis.feature_summaries),
        # Warnings
        "warnings": _build_warnings(analysis, velocity),
        # Talking points
        "talking_points": _build_talking_points(analysis, velocity),
        # Mutation summary (if available)
        "mutation_summary": mutation_summary,
    }

    return template.render(**ctx)
