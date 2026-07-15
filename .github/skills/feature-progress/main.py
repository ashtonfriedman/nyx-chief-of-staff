#!/usr/bin/env python3
"""
Feature Progress Skill — Main Entry Point
Orchestrates the feature progress pipeline: discovery → children → classification →
metrics → pace → summary → dashboard.

Read-only: never modifies ADO state (NFR-01).
"""

import argparse
import os
import stat
import sys
import time
from datetime import datetime, timezone

# Ensure skill directory is on the path for imports
SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
if SKILL_DIR not in sys.path:
    sys.path.insert(0, SKILL_DIR)

from constants import ORG, PROJECT, DEFAULT_AREA
from log_utils import log
from sprint_calendar import build_calendar
from feature_discovery import discover
from child_fetcher import fetch_all_children
from state_classifier import classify_all, StateBucket
from metrics import compute_all as compute_all_metrics
from pace_classifier import classify_all_pace
from period_summary import compute_summary, compute_zero_progress_alerts
from dashboard_html import generate_html


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Feature Progress Dashboard — forward-looking planning period feature tracker",
        epilog=(
            "Produces a self-contained HTML dashboard showing committed feature "
            "completion, pace tracking, and alerts. Read-only — never modifies ADO."
        ),
    )
    parser.add_argument(
        "--org", default=ORG,
        help=f"ADO organization URL (default: {ORG})",
    )
    parser.add_argument(
        "--project", default=PROJECT,
        help=f"ADO project name (default: {PROJECT})",
    )
    parser.add_argument(
        "--area", default=DEFAULT_AREA,
        help=f"ADO area path (default: {DEFAULT_AREA})",
    )
    parser.add_argument(
        "--output", "-o", default=None,
        help="Output HTML file path (default: auto-generated in temp dir)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    start_time = time.time()

    log("=" * 60)
    log("Feature Progress Dashboard")
    log("=" * 60)

    # Step 1: Build sprint calendar
    log("\n[1/8] Building sprint calendar...")
    calendar = build_calendar()
    current_sprint = calendar.get_current_sprint()
    current_sprint_name = current_sprint.name if current_sprint else ""
    log(f"  Found {len(calendar.sprints)} sprints, current: {current_sprint_name or 'unknown'}")
    if calendar.warnings:
        for w in calendar.warnings:
            log(f"  ⚠ {w}")

    # Step 2: Discover committed features
    log("\n[2/8] Discovering committed features...")
    discovery = discover()
    features = discovery.features
    log(f"  Committed: {len(features)} features")

    if not features:
        log("\nNo committed features found. Generating empty dashboard.")
        html = generate_html(
            features=[], classifications={}, metrics_map={}, pace_map={},
            children_map={}, summary=None, diagnostics=discovery.diagnostics,
            discovery_warnings=discovery.warnings, zero_progress_alerts=[],
            current_sprint_name=current_sprint_name,
        )
        _write_output(html, args.output)
        return

    # Step 3: Fetch children for all features
    log("\n[3/8] Fetching children...")
    feature_ids = [f.id for f in features]
    children_map = fetch_all_children(feature_ids)

    # Step 4: Classify feature states
    log("\n[4/8] Classifying feature states...")
    classifications = classify_all(features, children_map)
    state_counts = {}
    for cls in classifications.values():
        bucket = cls.bucket.value
        state_counts[bucket] = state_counts.get(bucket, 0) + 1
    log(f"  State distribution: {state_counts}")

    # Step 5: Compute metrics
    log("\n[5/8] Computing metrics...")
    metrics_map = compute_all_metrics(features, children_map)

    # Step 6: Classify pace
    log("\n[6/8] Classifying pace...")
    pace_map = classify_all_pace(features, children_map, metrics_map, calendar)

    # Step 7: Compute period summary
    log("\n[7/8] Computing period summary...")
    summary = compute_summary(features, classifications, calendar)
    zero_alerts = compute_zero_progress_alerts(
        features, classifications, children_map, calendar,
    )
    log(f"  FP: {summary.fp_completed:.0f}/{summary.fp_committed:.0f} done, "
        f"status: {summary.status.value}")
    if zero_alerts:
        log(f"  ⚠ {len(zero_alerts)} zero-progress alerts")

    # Step 8: Generate dashboard HTML
    log("\n[8/8] Generating dashboard...")
    html = generate_html(
        features=features,
        classifications=classifications,
        metrics_map=metrics_map,
        pace_map=pace_map,
        children_map=children_map,
        summary=summary,
        diagnostics=discovery.diagnostics,
        discovery_warnings=discovery.warnings,
        zero_progress_alerts=zero_alerts,
        current_sprint_name=current_sprint_name,
    )

    _write_output(html, args.output)

    elapsed = time.time() - start_time
    log(f"\nComplete in {elapsed:.1f}s")


def _write_output(html: str, output_path: str | None):
    """Write HTML to file with restricted permissions (SEC-08)."""
    if output_path:
        path = output_path
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        temp_dir = os.environ.get("TEMP", os.environ.get("TMPDIR", "."))
        path = os.path.join(temp_dir, f"feature-progress-{timestamp}.html")

    try:
        # Write with restricted permissions (SEC-08)
        fd = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(html)
        log(f"Dashboard written to {path}")
    except OSError:
        # Fallback: regular write
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        log(f"Dashboard written to {path}")

    # Print path to stdout for canvas_show consumption
    print(path)


if __name__ == "__main__":
    main()
