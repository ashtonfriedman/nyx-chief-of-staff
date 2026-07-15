#!/usr/bin/env python3
"""
Sprint Planning Skill — Orchestrator

Automates biweekly sprint boundary work: closing current sprint, preparing
next sprint, enforcing team conventions, ordering backlog, and producing
a visual HTML dashboard for the sprint planning meeting.

Usage:
  python .github/skills/sprint-planning/sprint_planning.py
  python .github/skills/sprint-planning/sprint_planning.py --dry-run
  python .github/skills/sprint-planning/sprint_planning.py --velocity 40
  python .github/skills/sprint-planning/sprint_planning.py --help
"""

import argparse
import html
import importlib
import importlib.util
import os
import sys
import types

# Ensure the skill directory is importable as a package.
# When run directly (python sprint_planning.py), sys.path[0] is the skill dir
# which shadows the package. Fix by inserting the parent so 'sprint_planning'
# resolves to this directory as a package.
_SKILL_DIR = os.path.dirname(os.path.abspath(__file__))
_SKILLS_DIR = os.path.dirname(_SKILL_DIR)
# Remove the skill dir itself from sys.path if present (avoids module/package conflict)
if _SKILL_DIR in sys.path:
    sys.path.remove(_SKILL_DIR)
if _SKILLS_DIR not in sys.path:
    sys.path.insert(0, _SKILLS_DIR)

# Now we can use the package (directory name = sprint-planning, so we use
# direct file imports to avoid the hyphen issue)
import importlib

def _import(mod_name):
    """Import a sibling module from the sprint-planning skill directory."""
    spec = importlib.util.spec_from_file_location(
        mod_name, os.path.join(_SKILL_DIR, f"{mod_name}.py")
    )
    mod = importlib.util.module_from_spec(spec)
    # Make submodule imports work within the loaded modules
    sys.modules[f"sprint_planning.{mod_name}"] = mod
    spec.loader.exec_module(mod)
    return mod

# Stub out the package itself so relative imports from submodules work
_pkg = types.ModuleType("sprint_planning")
_pkg.__path__ = [_SKILL_DIR]
_pkg.__package__ = "sprint_planning"
sys.modules["sprint_planning"] = _pkg

# Import all submodules
_wiql_builder = _import("wiql_builder")
_audit_mod = _import("audit")
_ado_client_mod = _import("ado_client")
_preflight_mod = _import("preflight")
_discovery_mod = _import("discovery")
_analyzer_mod = _import("analyzer")
_mutations_mod = _import("mutations")
_ordering_mod = _import("ordering")
_compliance_mod = _import("compliance")
_dashboard_mod = _import("dashboard")

# Re-export names used in this file
AdoClient = _ado_client_mod.AdoClient
AdoAuthError = _ado_client_mod.AdoAuthError
AuditLog = _audit_mod.AuditLog
enforce_preflight = _preflight_mod.enforce_preflight
discover_sprints = _discovery_mod.discover_sprints
run_full_analysis = _analyzer_mod.run_full_analysis
SprintAnalysis = _analyzer_mod.SprintAnalysis
WorkItem = _analyzer_mod.WorkItem
DEFAULT_VELOCITY = _analyzer_mod.DEFAULT_VELOCITY
check_interactive = _mutations_mod.check_interactive
request_approval = _mutations_mod.request_approval
execute_carryover = _mutations_mod.execute_carryover
execute_hierarchy_fixes = _mutations_mod.execute_hierarchy_fixes
execute_orphan_reparent = _mutations_mod.execute_orphan_reparent
execute_bug_sp_enforcement = _mutations_mod.execute_bug_sp_enforcement
check_abort_threshold = _mutations_mod.check_abort_threshold
report_results = _mutations_mod.report_results
MutationResult = _mutations_mod.MutationResult
compute_feature_order = _ordering_mod.compute_feature_order
compute_item_order = _ordering_mod.compute_item_order
execute_ordering = _ordering_mod.execute_ordering
get_compliance_ids_from_user = _compliance_mod.get_compliance_ids_from_user
execute_compliance = _compliance_mod.execute_compliance
render_dashboard = _dashboard_mod.render_dashboard


def parse_args():
    parser = argparse.ArgumentParser(
        description="Sprint Planning Skill — automates sprint boundary work"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Read-only mode: analyze and generate dashboard without proposing mutations",
    )
    parser.add_argument(
        "--skip-preflight", action="store_true",
        help="Skip preflight validation (dashboard-only mode, disables mutations)",
    )
    parser.add_argument(
        "--velocity", type=int, default=DEFAULT_VELOCITY,
        help=f"Team velocity override (default: {DEFAULT_VELOCITY} SP)",
    )
    parser.add_argument(
        "--output", choices=["canvas", "file", "stdout"], default="canvas",
        help="Dashboard output mode (default: canvas)",
    )
    return parser.parse_args()


def _format_carryover_summary(candidates) -> list[str]:
    """Build summary lines for carryover approval."""
    lines = []
    for c in candidates:
        wi = c.item
        sp = f"{wi.story_points:.0f}SP" if wi.story_points else "—"
        assigned = html.escape(wi.assigned_to) if wi.assigned_to else "unassigned"
        title = html.escape(wi.title)[:60]
        line = f"#{wi.id} {wi.work_item_type} [{wi.state}] {sp} {assigned} — {title}"
        if c.hierarchy_split:
            line += f" ⚠ HIERARCHY SPLIT (parent #{wi.parent_id} stays in current sprint)"
        lines.append(line)
    return lines


def _format_hierarchy_summary(violations) -> list[str]:
    """Build summary lines for hierarchy fix approval."""
    lines = []
    for v in violations:
        child = v.child
        parent = v.parent
        if v.is_circular:
            lines.append(
                f"#{child.id} ↔ #{parent.id}: CIRCULAR — manual fix required"
            )
        else:
            target = v.reparent_target_id
            lines.append(
                f"#{child.id} ({child.work_item_type}) → #{parent.id} ({parent.work_item_type}): "
                f"reparent to #{target}"
            )
    return lines


def _format_orphan_summary(orphans) -> list[str]:
    lines = []
    for wi in orphans:
        title = html.escape(wi.title)[:60]
        lines.append(f"#{wi.id} {wi.work_item_type} [{wi.state}] — {title} → reparent to Misc/Bugs")
    return lines


def _format_bug_sp_summary(bugs) -> list[str]:
    lines = []
    for wi in bugs:
        title = html.escape(wi.title)[:60]
        lines.append(f"#{wi.id} {title} — set SP to 1")
    return lines


def main():
    args = parse_args()
    dry_run = args.dry_run or args.skip_preflight

    print("🏃 Sprint Planning Skill", file=sys.stderr)
    print("=" * 40, file=sys.stderr)

    # Initialize ADO client
    try:
        client = AdoClient()
        # Force token acquisition early to catch auth issues
        _ = client.token
    except AdoAuthError as e:
        print(f"❌ Authentication failed: {e}", file=sys.stderr)
        print("Ensure 'az login' has been run and you have ADO access.", file=sys.stderr)
        sys.exit(1)

    # Initialize audit log
    audit = AuditLog(_SKILL_DIR)

    # Phase 1: Preflight (FR-023)
    if not args.skip_preflight:
        enforce_preflight(client)
    else:
        print("⏭ Preflight skipped (--skip-preflight)", file=sys.stderr)

    # Phase 2: Sprint Discovery (FR-001)
    sprints = discover_sprints(client)

    # Phase 3: Full Analysis (NFR-002: all reads before writes)
    analysis = run_full_analysis(
        client,
        sprints.current.path,
        sprints.next_sprint.path,
        args.velocity,
    )

    mutation_summary = {}

    if not dry_run:
        # Check interactive mode (FR-021)
        check_interactive()

        # ── Carryover (FR-003, FR-004, FR-005) ──
        if analysis.carryover_candidates:
            summary = _format_carryover_summary(analysis.carryover_candidates)
            print(f"\n📦 {len(analysis.carryover_candidates)} carryover candidates found:", file=sys.stderr)
            approved_ids = request_approval(
                summary,
                [c.item.id for c in analysis.carryover_candidates],
            )
            if approved_ids:
                approved_set = set(approved_ids)
                approved_candidates = [
                    c for c in analysis.carryover_candidates
                    if c.item.id in approved_set
                ]
                result = execute_carryover(
                    client, approved_candidates,
                    sprints.next_sprint.path, audit,
                )
                report_results("Carryover Moves", result)
                mutation_summary["Carryover Moves"] = {
                    "succeeded": result.succeeded,
                    "skipped": result.skipped,
                    "failed": result.failed,
                }
            else:
                print("  ⏭ Carryover skipped", file=sys.stderr)
        else:
            print("\n✅ No carryover candidates", file=sys.stderr)

        # ── Hierarchy Fixes (FR-006, FR-007) ──
        non_circular = [v for v in analysis.hierarchy_violations if not v.is_circular]
        if non_circular:
            summary = _format_hierarchy_summary(non_circular)
            print(f"\n🔗 {len(non_circular)} hierarchy violations found:", file=sys.stderr)
            approved_ids = request_approval(
                summary,
                [v.child.id for v in non_circular],
            )
            if approved_ids:
                approved_set = set(approved_ids)
                approved_violations = [
                    v for v in non_circular if v.child.id in approved_set
                ]
                result = execute_hierarchy_fixes(client, approved_violations, audit)
                report_results("Hierarchy Fixes", result)
                mutation_summary["Hierarchy Fixes"] = {
                    "succeeded": result.succeeded,
                    "skipped": result.skipped,
                    "failed": result.failed,
                }
            else:
                print("  ⏭ Hierarchy fixes skipped", file=sys.stderr)
        else:
            print("\n✅ No hierarchy violations", file=sys.stderr)

        # ── Orphan Reparenting (FR-008) ──
        if analysis.orphaned_items:
            summary = _format_orphan_summary(analysis.orphaned_items)
            print(f"\n🔗 {len(analysis.orphaned_items)} orphaned items found:", file=sys.stderr)
            approved_ids = request_approval(
                summary,
                [wi.id for wi in analysis.orphaned_items],
            )
            if approved_ids:
                approved_set = set(approved_ids)
                approved_orphans = [
                    wi for wi in analysis.orphaned_items if wi.id in approved_set
                ]
                result = execute_orphan_reparent(client, approved_orphans, audit)
                report_results("Orphan Reparenting", result)
                mutation_summary["Orphan Reparenting"] = {
                    "succeeded": result.succeeded,
                    "skipped": result.skipped,
                    "failed": result.failed,
                }
            else:
                print("  ⏭ Orphan reparenting skipped", file=sys.stderr)
        else:
            print("\n✅ No orphaned items", file=sys.stderr)

        # ── Bug SP Enforcement (FR-009) ──
        if analysis.uncosted_bugs:
            summary = _format_bug_sp_summary(analysis.uncosted_bugs)
            print(f"\n💲 {len(analysis.uncosted_bugs)} uncosted bugs found:", file=sys.stderr)
            approved_ids = request_approval(
                summary,
                [wi.id for wi in analysis.uncosted_bugs],
            )
            if approved_ids:
                approved_set = set(approved_ids)
                approved_bugs = [
                    wi for wi in analysis.uncosted_bugs if wi.id in approved_set
                ]
                result = execute_bug_sp_enforcement(client, approved_bugs, audit)
                report_results("Bug SP Enforcement", result)
                mutation_summary["Bug SP Enforcement"] = {
                    "succeeded": result.succeeded,
                    "skipped": result.skipped,
                    "failed": result.failed,
                }
            else:
                print("  ⏭ Bug SP enforcement skipped", file=sys.stderr)
        else:
            print("\n✅ All bugs have story points", file=sys.stderr)

        # ── Abort threshold check ──
        all_results = [
            MutationResult(**d) for d in mutation_summary.values()
        ]
        if check_abort_threshold(all_results, structural=True):
            print(
                "\n⚠ >50% of structural mutations were skipped. "
                "Items may have changed since analysis. Please re-run.",
                file=sys.stderr,
            )
            audit.log("abort_threshold", detail="Exceeded 50% skip rate")
        else:
            # ── Backlog Ordering (FR-010, FR-011) ──
            print("\n📊 Computing backlog ordering...", file=sys.stderr)
            feature_order = compute_feature_order(
                analysis.feature_summaries, analysis.current_items + analysis.next_items,
            )
            item_order = compute_item_order(feature_order, analysis.feature_summaries)
            ordering_result = execute_ordering(client, feature_order, item_order, audit)
            report_results("Backlog Ordering", ordering_result)
            mutation_summary["Backlog Ordering"] = {
                "succeeded": ordering_result.succeeded,
                "skipped": ordering_result.skipped,
                "failed": ordering_result.failed,
            }

        # ── Compliance Handling (FR-016) ──
        all_loaded_ids = {wi.id for wi in analysis.current_items + analysis.next_items}
        items_map = {wi.id: wi for wi in analysis.current_items + analysis.next_items}
        compliance_ids = get_compliance_ids_from_user(all_loaded_ids)
        if compliance_ids:
            # Build approval summary
            compliance_summary = [
                f"#{iid} — unassign, reparent to the compliance backlog, confirm area path"
                for iid in compliance_ids
            ]
            approved = request_approval(compliance_summary, compliance_ids)
            if approved:
                result = execute_compliance(client, approved, items_map, audit)
                report_results("Compliance Handling", result)
                mutation_summary["Compliance Handling"] = {
                    "succeeded": result.succeeded,
                    "skipped": result.skipped,
                    "failed": result.failed,
                }

                # Refresh analysis for dashboard
                print("\n🔄 Refreshing analysis after Compliance changes...", file=sys.stderr)
                analysis = run_full_analysis(
                    client, sprints.current.path, sprints.next_sprint.path, args.velocity,
                )
    else:
        print("\n📋 Dry run — no mutations proposed", file=sys.stderr)

    # ── Dashboard Generation (FR-017–FR-020) ──
    print("\n🎨 Generating dashboard...", file=sys.stderr)
    dashboard_html = render_dashboard(
        analysis,
        sprints.current.name,
        sprints.next_sprint.name,
        args.velocity,
        mutation_summary if mutation_summary else None,
    )

    if args.output == "stdout":
        print(dashboard_html)
    elif args.output == "file":
        out_path = os.path.join(_SKILL_DIR, "dashboard.html")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(dashboard_html)
        print(f"\n📄 Dashboard written to: {out_path}", file=sys.stderr)
    else:
        # Canvas output — write file, then emit machine-parseable markers to stdout.
        #
        # Contract: the agent reads stdout for these markers and invokes canvas_show /
        # canvas_update accordingly.  All other output goes to stderr so the stdout
        # channel is clean for parsing.
        #
        #   CANVAS_FILE: <absolute path>   — path of the self-contained HTML file
        #   CANVAS_NAME: sprint-planning   — stable canvas name (used for canvas_update)
        #
        # the agent workflow:
        #   First invocation  → canvas_show(file=CANVAS_FILE, name=CANVAS_NAME, port=9999)
        #   Subsequent runs   → canvas_update(name=CANVAS_NAME, html=<file content>)
        #   or equivalently   → canvas_show(file=CANVAS_FILE, name=CANVAS_NAME, open_browser=False)
        out_path = os.path.join(_SKILL_DIR, "dashboard.html")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(dashboard_html)
        # Machine-parseable lines on stdout — the agent parses these to drive canvas tools.
        print(f"CANVAS_FILE: {out_path}")
        print("CANVAS_NAME: sprint-planning")
        # Human-readable status to stderr (not part of the parseable contract).
        print(f"\n📄 Dashboard ready: {out_path}", file=sys.stderr)
        print(
            "the agent: call canvas_show(file=path, name='sprint-planning', port=9999) "
            "or canvas_update(name='sprint-planning') as appropriate.",
            file=sys.stderr,
        )

    # Close audit log
    audit.close()
    print(f"\n✅ Sprint planning complete. Audit log: {audit.path}", file=sys.stderr)


if __name__ == "__main__":
    main()
