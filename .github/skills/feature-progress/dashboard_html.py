"""
Feature Progress Skill — Dashboard HTML Generator
Self-contained dark-theme HTML dashboard with collapsible sections,
DOM-based sorting, accessibility features.

Covers: FR-09, FR-10, FR-11, NFR-05, NFR-06, SEC-04, SEC-05
"""

from __future__ import annotations

from datetime import datetime, timezone

from security_utils import html_escape, validate_id, build_ado_url
from state_classifier import StateBucket
from pace_classifier import PaceStatus
from feature_discovery import provenance_label

CSS = """
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont,
    'Segoe UI', Helvetica, Arial, sans-serif; padding: 20px; line-height: 1.6;
}
h1 { color: #58a6ff; margin-bottom: 8px; font-size: 1.6em; }
h2 { color: #8b949e; font-size: 1.1em; margin: 16px 0 8px; }
.summary-bar {
    display: flex; flex-wrap: wrap; gap: 16px; padding: 16px;
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    margin-bottom: 16px; align-items: center;
}
.summary-item { text-align: center; min-width: 100px; }
.summary-item .label { font-size: 0.75em; color: #8b949e; text-transform: uppercase; }
.summary-item .value { font-size: 1.5em; font-weight: 600; }
.badge {
    display: inline-block; padding: 2px 8px; border-radius: 12px;
    font-size: 0.8em; font-weight: 600; margin: 2px;
}
.badge-green { background: #238636; color: #fff; }
.badge-yellow { background: #9e6a03; color: #fff; }
.badge-red { background: #da3633; color: #fff; }
.badge-blue { background: #1f6feb; color: #fff; }
.badge-gray { background: #30363d; color: #8b949e; }
.badge-blocked { background: #f85149; color: #fff; }
.badge-warn { background: #9e6a03; color: #fff; }
table {
    width: 100%; border-collapse: collapse; margin: 8px 0;
    background: #0d1117;
}
th {
    background: #161b22; color: #8b949e; text-align: left; padding: 8px 12px;
    border-bottom: 2px solid #30363d; cursor: pointer; user-select: none;
    font-size: 0.85em;
}
th:hover { color: #c9d1d9; }
th[aria-sort="ascending"]::after { content: " ▲"; }
th[aria-sort="descending"]::after { content: " ▼"; }
td { padding: 8px 12px; border-bottom: 1px solid #21262d; font-size: 0.9em; }
tr:hover { background: #161b22; }
a { color: #58a6ff; text-decoration: none; }
a:hover { text-decoration: underline; }
details { margin: 8px 0; }
summary {
    cursor: pointer; padding: 8px 12px; background: #161b22;
    border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;
    font-weight: 600;
}
summary:hover { background: #1c2128; }
.child-table { margin-left: 24px; width: calc(100% - 24px); }
.child-table td { font-size: 0.85em; padding: 4px 8px; }
.blocked-child { background: #2d1b1e !important; }
.blocked-child td { color: #f85149; }
.alert-section {
    padding: 12px 16px; background: #1c1b22; border: 1px solid #30363d;
    border-radius: 6px; margin: 8px 0;
}
.alert-item { padding: 4px 0; border-bottom: 1px solid #21262d; }
.alert-item:last-child { border-bottom: none; }
.diagnostics {
    padding: 12px; background: #161b22; border: 1px solid #30363d;
    border-radius: 6px; font-size: 0.85em; margin: 8px 0;
}
.diag-row { display: flex; gap: 12px; padding: 4px 0; }
.diag-label { color: #8b949e; min-width: 140px; }
.diag-value { color: #c9d1d9; }
.warning-text { color: #d29922; }
.footer {
    margin-top: 24px; padding: 12px; border-top: 1px solid #30363d;
    font-size: 0.8em; color: #484f58;
}
.provenance { font-size: 0.75em; color: #8b949e; }
.sp-unreliable { opacity: 0.6; font-style: italic; }
.progress-section {
    padding: 16px; background: #161b22; border: 1px solid #30363d;
    border-radius: 8px; margin: 16px 0;
}
"""

SORT_JS = """
<script>
(function(){
  document.querySelectorAll('th[data-sort]').forEach(function(th){
    th.addEventListener('click', function(){
      var table = th.closest('table');
      var tbody = table.querySelector('tbody');
      if(!tbody) return;
      var idx = Array.from(th.parentNode.children).indexOf(th);
      var rows = Array.from(tbody.querySelectorAll('tr.feature-row'));
      var type = th.getAttribute('data-sort');
      var dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
      th.parentNode.querySelectorAll('th').forEach(function(h){ h.removeAttribute('aria-sort'); });
      th.setAttribute('aria-sort', dir);
      rows.sort(function(a, b){
        var av = a.children[idx] ? a.children[idx].getAttribute('data-val') || a.children[idx].textContent : '';
        var bv = b.children[idx] ? b.children[idx].getAttribute('data-val') || b.children[idx].textContent : '';
        if(type === 'num'){ av = parseFloat(av)||0; bv = parseFloat(bv)||0; }
        else { av = av.toLowerCase(); bv = bv.toLowerCase(); }
        if(av < bv) return dir === 'ascending' ? -1 : 1;
        if(av > bv) return dir === 'ascending' ? 1 : -1;
        return 0;
      });
      rows.forEach(function(r){
        var detail = r.nextElementSibling;
        tbody.appendChild(r);
        if(detail && detail.classList.contains('child-detail-row')) tbody.appendChild(detail);
      });
    });
  });
})();
</script>
"""


def _state_badge(bucket: StateBucket, blocked: bool = False) -> str:
    """Render a state badge."""
    badge_class = {
        StateBucket.NOT_STARTED: "badge-gray",
        StateBucket.IN_PROGRESS: "badge-blue",
        StateBucket.COMPLETE: "badge-green",
        StateBucket.REMOVED: "badge-gray",
    }.get(bucket, "badge-gray")

    html = (
        f'<span class="badge {badge_class}" '
        f'aria-label="State: {html_escape(bucket.value)}">'
        f'{html_escape(bucket.value)}</span>'
    )
    if blocked:
        html += (
            ' <span class="badge badge-blocked" '
            'aria-label="Blocked">Blocked</span>'
        )
    return html


def _pace_badge(pace_result) -> str:
    """Render a pace status badge or suppression reason."""
    if pace_result.suppressed:
        return f'<span class="provenance">{html_escape(pace_result.reason)}</span>'

    badge_map = {
        PaceStatus.ON_PACE: ("badge-green", "On Pace"),
        PaceStatus.AT_RISK: ("badge-yellow", "At Risk"),
        PaceStatus.BEHIND: ("badge-red", "Behind"),
    }
    cls, label = badge_map.get(pace_result.status, ("badge-gray", "Unknown"))
    title = f"Actual: {pace_result.actual_pct:.0f}% / Expected: {pace_result.expected_pct:.0f}%"
    return (
        f'<span class="badge {cls}" aria-label="Pace: {html_escape(label)}" '
        f'title="{html_escape(title)}">{html_escape(label)}</span>'
    )


def render_summary_bar(summary) -> str:
    """Render the period summary bar."""
    current_sprint = ""
    if hasattr(summary, "_current_sprint_name"):
        current_sprint = summary._current_sprint_name

    status_badge_class = {
        "On Pace": "badge-green",
        "At Risk": "badge-yellow",
        "Behind": "badge-red",
    }.get(summary.status.value, "badge-gray")

    projection_text = ""
    if summary.projection_available:
        projection_text = f"{summary.projection:.1f} FP"
    else:
        projection_text = "Insufficient data"

    return f"""
    <div class="summary-bar" role="region" aria-labelledby="summary-heading">
        <div class="summary-item">
            <div class="label">FP Done</div>
            <div class="value">{summary.fp_completed:.0f}</div>
        </div>
        <div class="summary-item">
            <div class="label">FP Committed</div>
            <div class="value">{summary.fp_committed:.0f}</div>
        </div>
        <div class="summary-item">
            <div class="label">FP Remaining</div>
            <div class="value">{summary.fp_remaining:.0f}</div>
        </div>
        <div class="summary-item">
            <div class="label">Sprints Elapsed</div>
            <div class="value">{summary.sprints_elapsed}</div>
        </div>
        <div class="summary-item">
            <div class="label">Sprints Remaining</div>
            <div class="value">{summary.sprints_remaining}</div>
        </div>
        <div class="summary-item">
            <div class="label">Period Status</div>
            <div class="value">
                <span class="badge {status_badge_class}"
                      aria-label="Period status: {html_escape(summary.status.value)}">
                    {html_escape(summary.status_emoji)} {html_escape(summary.status.value)}
                </span>
            </div>
        </div>
        <div class="summary-item">
            <div class="label">Simple Pace Projection</div>
            <div class="value" style="font-size:1em">{html_escape(projection_text)}</div>
        </div>
        {f'<div class="summary-item"><div class="label">Current Sprint</div><div class="value" style="font-size:0.9em">{html_escape(current_sprint)}</div></div>' if current_sprint else ''}
    </div>
    """


def render_discovery_diagnostics(diagnostics: dict, warnings: list[str]) -> str:
    """Render the discovery diagnostics section."""
    rows = ""
    for strategy, info in diagnostics.items():
        status = info.get("status", "unknown")
        count = info.get("count", 0)
        status_display = {
            "success": "✅ Success",
            "empty": "⚠️ No results",
            "skipped": "⏭️ Skipped",
            "failed": "❌ Failed",
        }.get(status, status)

        rows += f"""
        <div class="diag-row">
            <span class="diag-label">{html_escape(strategy.replace('_', ' ').title())}</span>
            <span class="diag-value">{html_escape(status_display)} ({count} features)</span>
        </div>
        """

    warning_html = ""
    if warnings:
        warning_html = '<div style="margin-top:8px">'
        for w in warnings:
            warning_html += (
                f'<div class="alert-item warning-text">⚠ {html_escape(w)}</div>'
            )
        warning_html += "</div>"

    return f"""
    <details role="region" aria-labelledby="diagnostics-heading">
        <summary id="diagnostics-heading">📊 Discovery Diagnostics</summary>
        <div class="diagnostics">
            {rows}
            {warning_html}
        </div>
    </details>
    """


def render_feature_table(
    features: list,
    classifications: dict,
    metrics_map: dict,
    pace_map: dict,
    children_map: dict,
) -> str:
    """Render the feature table with expandable child details."""
    header = """
    <table role="grid" aria-label="Committed Features">
        <thead>
            <tr>
                <th scope="col" data-sort="num" aria-label="Sort by ID">ID</th>
                <th scope="col" data-sort="text" aria-label="Sort by Title">Title</th>
                <th scope="col" data-sort="num" aria-label="Sort by FP">FP</th>
                <th scope="col" data-sort="text" aria-label="Sort by State">State</th>
                <th scope="col" data-sort="text" aria-label="Sort by Stories">Stories</th>
                <th scope="col" data-sort="text" aria-label="Sort by SP">SP</th>
                <th scope="col" data-sort="num" aria-label="Sort by Completion">Completion %</th>
                <th scope="col" data-sort="text" aria-label="Sort by Pace">Pace</th>
                <th scope="col" data-sort="text" aria-label="Sort by Source">Source</th>
            </tr>
        </thead>
        <tbody>
    """

    rows = ""
    for feature in features:
        fid = feature.id
        cls = classifications.get(fid)
        mr = metrics_map.get(fid)
        pr = pace_map.get(fid)
        fc = children_map.get(fid)

        # ID link
        url = build_ado_url(fid)
        id_cell = f'<a href="{html_escape(url)}" target="_blank">{fid}</a>'

        # FP
        fp_display = f"{feature.fp:.0f}" if feature.fp is not None else "—"

        # State badge
        state_html = _state_badge(
            cls.bucket if cls else StateBucket.NOT_STARTED,
            cls.blocked_overlay if cls else False,
        )
        # Additional flags
        if cls and cls.is_unscoped:
            state_html += ' <span class="badge badge-warn" aria-label="Unscoped">Unscoped</span>'
        if cls and cls.all_removed_flag:
            state_html += (
                ' <span class="badge badge-warn" aria-label="All removed">'
                'All Removed</span>'
            )

        # Metrics
        if mr and mr.data_unavailable:
            stories_cell = "data unavailable"
            sp_cell = "data unavailable"
            completion_cell = "—"
            completion_val = "0"
        elif mr:
            stories_cell = f"{mr.done_stories}/{mr.total_stories}"
            sp_str = f"{mr.done_sp:.0f}/{mr.total_sp:.0f}"
            if not mr.sp_reliable:
                sp_cell = (
                    f'<span class="sp-unreliable" title="Unreliable — insufficient SP coverage">'
                    f'⚠ {sp_str}</span>'
                )
            else:
                sp_cell = sp_str
            completion_pct = mr.sp_completion_pct if mr.sp_reliable else mr.story_completion_pct
            completion_cell = f"{completion_pct:.0f}%"
            completion_val = f"{completion_pct:.1f}"
        else:
            stories_cell = "—"
            sp_cell = "—"
            completion_cell = "—"
            completion_val = "0"

        # SP coverage warning badge
        sp_warn = ""
        if mr and mr.low_sp_coverage and not mr.data_unavailable:
            sp_warn = (
                ' <span class="badge badge-warn" '
                'aria-label="Estimates incomplete">'
                '⚠ Estimates incomplete — pace based on story count</span>'
            )

        # Pace
        pace_html = _pace_badge(pr) if pr else '<span class="provenance">—</span>'

        # Provenance
        prov = html_escape(provenance_label(feature.provenance))

        rows += f"""
        <tr class="feature-row">
            <td data-val="{fid}">{id_cell}</td>
            <td>{html_escape(feature.title_raw)}{sp_warn}</td>
            <td data-val="{feature.fp if feature.fp is not None else 0}">{fp_display}</td>
            <td>{state_html}</td>
            <td>{stories_cell}</td>
            <td>{sp_cell}</td>
            <td data-val="{completion_val}">{completion_cell}</td>
            <td>{pace_html}</td>
            <td><span class="provenance">{prov}</span></td>
        </tr>
        """

        # Expandable child detail row
        child_html = _render_children(fc, fid)
        if child_html:
            rows += f"""
            <tr class="child-detail-row">
                <td colspan="9">
                    <details>
                        <summary>📋 {len(fc.children) if fc else 0} child items</summary>
                        {child_html}
                    </details>
                </td>
            </tr>
            """

    return header + rows + "</tbody></table>"


def _render_children(fc, feature_id: int) -> str:
    """Render the child items table for a feature."""
    if not fc or not fc.children:
        return ""

    children = fc.children
    show_limit = 50
    truncated = len(children) > show_limit
    display_children = children[:show_limit]

    rows = ""
    for child in display_children:
        child_id = child.id
        url = build_ado_url(child_id)
        id_link = f'<a href="{html_escape(url)}" target="_blank">{child_id}</a>'

        sp_display = f"{child.sp:.0f}" if child.sp is not None else "—"
        assigned = html_escape(child.assigned_display_name)
        blocked_class = ' class="blocked-child"' if child.is_blocked else ""
        blocked_badge = (
            ' <span class="badge badge-blocked" aria-label="Blocked">BLOCKED</span>'
            if child.is_blocked else ""
        )

        rows += f"""
        <tr{blocked_class}>
            <td>{id_link}</td>
            <td>{html_escape(child.title_raw)}{blocked_badge}</td>
            <td>{html_escape(child.type)}</td>
            <td>{html_escape(child.state_raw)}</td>
            <td>{sp_display}</td>
            <td>{assigned}</td>
        </tr>
        """

    toggle_html = ""
    if truncated:
        remaining = len(children) - show_limit
        extra_rows = ""
        for child in children[show_limit:]:
            child_id = child.id
            url = build_ado_url(child_id)
            id_link = f'<a href="{html_escape(url)}" target="_blank">{child_id}</a>'
            sp_display = f"{child.sp:.0f}" if child.sp is not None else "—"
            assigned = html_escape(child.assigned_display_name)
            blocked_class = ' class="blocked-child"' if child.is_blocked else ""
            blocked_badge = (
                ' <span class="badge badge-blocked" aria-label="Blocked">BLOCKED</span>'
                if child.is_blocked else ""
            )
            extra_rows += f"""
            <tr{blocked_class} style="display:none" class="extra-child-{feature_id}">
                <td>{id_link}</td>
                <td>{html_escape(child.title_raw)}{blocked_badge}</td>
                <td>{html_escape(child.type)}</td>
                <td>{html_escape(child.state_raw)}</td>
                <td>{sp_display}</td>
                <td>{assigned}</td>
            </tr>
            """
        rows += extra_rows
        toggle_html = f"""
        <tr><td colspan="6" style="text-align:center">
            <button onclick="document.querySelectorAll('.extra-child-{feature_id}').forEach(function(r){{r.style.display=r.style.display==='none'?'':'none'}}); this.textContent=this.textContent.indexOf('Show')>=0?'Hide {remaining} stories':'Show {remaining} more stories'">
                Show {remaining} more stories
            </button>
        </td></tr>
        """

    return f"""
    <table class="child-table" role="grid" aria-label="Child items for feature {feature_id}">
        <thead>
            <tr>
                <th scope="col">ID</th>
                <th scope="col">Title</th>
                <th scope="col">Type</th>
                <th scope="col">State</th>
                <th scope="col">SP</th>
                <th scope="col">Assigned To</th>
            </tr>
        </thead>
        <tbody>
            {rows}
            {toggle_html}
        </tbody>
    </table>
    """


def render_alerts(
    zero_progress_alerts: list,
    pace_map: dict,
    features: list,
    classifications: dict,
    metrics_map: dict,
    discovery_warnings: list[str],
) -> str:
    """Render the alerts section."""
    sections = []

    # Zero-progress alerts (FR-07)
    if zero_progress_alerts:
        items = ""
        for alert in zero_progress_alerts:
            alert_icon = "🚫" if alert.alert_type == "no_children" else "⏸️"
            alert_desc = (
                "No child stories — decomposition needed"
                if alert.alert_type == "no_children"
                else "All stories not started"
            )
            fp_str = f"{alert.fp:.0f} FP" if alert.fp else "No FP"
            items += f"""
            <div class="alert-item">
                {alert_icon} <strong>Feature {alert.feature_id}</strong>:
                {html_escape(alert.title_raw)} ({fp_str}) — {alert_desc}<br>
                <span class="provenance" style="margin-left:24px">
                    {html_escape(alert.latest_start_sprint)}
                </span>
            </div>
            """
        sections.append(f"""
        <details open role="region" aria-labelledby="zero-progress-heading">
            <summary id="zero-progress-heading">🚨 Zero Progress Features ({len(zero_progress_alerts)})</summary>
            <div class="alert-section">{items}</div>
        </details>
        """)

    # Behind-pace features
    behind_features = []
    for feature in features:
        pr = pace_map.get(feature.id)
        if pr and not pr.suppressed and pr.status == PaceStatus.BEHIND:
            behind_features.append((feature, pr))
    if behind_features:
        items = ""
        for feature, pr in behind_features:
            items += f"""
            <div class="alert-item">
                🔴 <strong>Feature {feature.id}</strong>:
                {html_escape(feature.title_raw)} —
                Actual: {pr.actual_pct:.0f}% / Expected: {pr.expected_pct:.0f}%
            </div>
            """
        sections.append(f"""
        <details open role="region" aria-labelledby="behind-pace-heading">
            <summary id="behind-pace-heading">🔴 Behind Pace Features ({len(behind_features)})</summary>
            <div class="alert-section">{items}</div>
        </details>
        """)

    # Suppressed-pace features
    suppressed = []
    for feature in features:
        pr = pace_map.get(feature.id)
        if pr and pr.suppressed:
            suppressed.append((feature, pr))
    if suppressed:
        items = ""
        for feature, pr in suppressed:
            items += f"""
            <div class="alert-item">
                ⚠️ <strong>Feature {feature.id}</strong>:
                {html_escape(feature.title_raw)} — {html_escape(pr.reason)}
            </div>
            """
        sections.append(f"""
        <details role="region" aria-labelledby="suppressed-heading">
            <summary id="suppressed-heading">⚠️ Pace Suppressed ({len(suppressed)})</summary>
            <div class="alert-section">{items}</div>
        </details>
        """)

    # Data quality warnings
    if discovery_warnings:
        items = ""
        for w in discovery_warnings:
            items += f'<div class="alert-item warning-text">⚠ {html_escape(w)}</div>'
        sections.append(f"""
        <details role="region" aria-labelledby="warnings-heading">
            <summary id="warnings-heading">📋 Data Quality Warnings ({len(discovery_warnings)})</summary>
            <div class="alert-section">{items}</div>
        </details>
        """)

    if not sections:
        return '<div class="diagnostics">✅ No alerts</div>'

    return "\n".join(sections)


def render_progress_summary(summary) -> str:
    """Render the progress summary section."""
    if not summary.projection_available:
        projection_text = "Insufficient data for projection"
    else:
        surplus = summary.projection - summary.fp_committed
        if surplus >= 0:
            surplus_text = f"Surplus: +{surplus:.1f} FP"
        else:
            surplus_text = f"Deficit: {surplus:.1f} FP"
        projection_text = (
            f"Simple pace projection: {summary.projection:.1f} FP at period end "
            f"({surplus_text})"
        )

    fp_without = ""
    if summary.features_without_fp > 0:
        fp_without = (
            f"<br><span class='warning-text'>⚠ {summary.features_without_fp} "
            f"feature(s) have no FP estimate — excluded from projection</span>"
        )

    return f"""
    <div class="progress-section" role="region" aria-labelledby="progress-heading">
        <h2 id="progress-heading">📈 Period Progress</h2>
        <p>FP Completed: <strong>{summary.fp_completed:.0f}</strong> /
           FP Committed: <strong>{summary.fp_committed:.0f}</strong> /
           FP Remaining: <strong>{summary.fp_remaining:.0f}</strong></p>
        <p>{html_escape(projection_text)}{fp_without}</p>
    </div>
    """


def render_footer(timestamp: str | None = None) -> str:
    """Render the dashboard footer."""
    ts = timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f"""
    <div class="footer">
        <p>Data fetched: {html_escape(ts)} — All metrics are point-in-time.</p>
        <p>Internal use only — contains project delivery data.</p>
        <p><em>Exclusion tags (CutTag, {{FISCAL_QUARTER}} Cut) always override inclusion signals.
        Simple pace projection is arithmetic extrapolation only — not a predictive model.</em></p>
    </div>
    """


def render_empty_dashboard(diagnostics: dict, warnings: list[str]) -> str:
    """Render an empty dashboard when no features are found (EC-09)."""
    diag_html = render_discovery_diagnostics(diagnostics, warnings)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>Feature Progress — No Data</title>
    <style>{CSS}</style>
</head>
<body>
    <h1>📊 Feature Progress Dashboard</h1>
    <div class="alert-section" style="margin:16px 0;text-align:center;">
        <h2>No committed features found for this period.</h2>
        <p style="color:#8b949e">Verify iteration paths, check tags, confirm area path.</p>
    </div>
    {diag_html}
    {render_footer()}
</body>
</html>"""


def generate_html(
    features: list,
    classifications: dict,
    metrics_map: dict,
    pace_map: dict,
    children_map: dict,
    summary,
    diagnostics: dict,
    discovery_warnings: list[str],
    zero_progress_alerts: list,
    current_sprint_name: str = "",
) -> str:
    """Generate the complete HTML dashboard."""
    if not features:
        return render_empty_dashboard(diagnostics, discovery_warnings)

    # Attach current sprint name to summary for rendering
    summary._current_sprint_name = current_sprint_name

    summary_bar = render_summary_bar(summary)
    diag_html = render_discovery_diagnostics(diagnostics, discovery_warnings)
    table_html = render_feature_table(
        features, classifications, metrics_map, pace_map, children_map,
    )
    alerts_html = render_alerts(
        zero_progress_alerts, pace_map, features,
        classifications, metrics_map, discovery_warnings,
    )
    progress_html = render_progress_summary(summary)
    footer_html = render_footer()

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="robots" content="noindex, nofollow">
    <title>Feature Progress Dashboard</title>
    <style>{CSS}</style>
</head>
<body>
    <h1>📊 Feature Progress Dashboard</h1>
    <h2 id="summary-heading" style="margin-bottom:4px">Period Summary</h2>
    {summary_bar}
    {diag_html}
    <h2>Committed Features ({len(features)})</h2>
    {table_html}
    <h2>Alerts</h2>
    {alerts_html}
    {progress_html}
    {footer_html}
    {SORT_JS}
</body>
</html>"""
