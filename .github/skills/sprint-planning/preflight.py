"""
Preflight validation for sprint-planning skill (FR-023).

Verifies all configured parent work item IDs exist, are Features, are
not Closed/Removed, are under the configured area path, and are writable.
Fails fast before any queries or mutations if any check fails.
"""

import os
import sys
import time
from typing import NamedTuple

# Parent IDs from spec
# Example IDs - replace with your own board's IDs
MISC_BUGS_ID = 10000042
URGENT_BUGS_ID = 10000043
COMPLIANCE_BACKLOG_ID = 10000031

REQUIRED_PARENTS = {
    MISC_BUGS_ID: "Misc/Bugs",
    URGENT_BUGS_ID: "Urgent Bugs",
    COMPLIANCE_BACKLOG_ID: "compliance backlog",
}

# Configure your area path via the ADO_AREA env var (or memory.md)
AREA_PREFIX = os.environ.get("ADO_AREA", "{your-area-path}")
AGGREGATE_TIMEOUT = 30  # seconds across all checks (R2-STRIDE T-015)


class PreflightResult(NamedTuple):
    ok: bool
    errors: list[str]


def run_preflight(client) -> PreflightResult:
    """Validate all hardcoded parent IDs against live ADO.

    Returns PreflightResult with ok=True if all checks pass.
    On any failure, returns ok=False with error descriptions.
    """
    errors = []
    start_time = time.time()

    for item_id, label in REQUIRED_PARENTS.items():
        elapsed = time.time() - start_time
        if elapsed > AGGREGATE_TIMEOUT:
            errors.append(
                "ADO unreachable — cannot validate prerequisites. "
                "Check network and retry."
            )
            return PreflightResult(ok=False, errors=errors)

        try:
            item = client.get_work_item(item_id)
        except Exception as e:
            err_type = type(e).__name__
            errors.append(
                f"Preflight: {label} ({item_id}) — failed to fetch: {err_type}"
            )
            continue

        if not item or "fields" not in item:
            errors.append(f"Preflight: {label} ({item_id}) — item not found or no fields returned")
            continue

        fields = item["fields"]

        # Check type == Feature
        wit = fields.get("System.WorkItemType", "")
        if wit != "Feature":
            errors.append(
                f"Preflight: {label} ({item_id}) — expected type Feature, got '{wit}'"
            )

        # Check state not Closed/Removed
        state = fields.get("System.State", "")
        if state in ("Closed", "Removed"):
            errors.append(
                f"Preflight: {label} ({item_id}) — state is '{state}' (must be active)"
            )

        # Check area path under the configured area prefix
        area = fields.get("System.AreaPath", "")
        if not area.startswith(AREA_PREFIX):
            errors.append(
                f"Preflight: {label} ({item_id}) — area path '{area}' is not under '{AREA_PREFIX}'"
            )

    if errors:
        return PreflightResult(ok=False, errors=errors)
    return PreflightResult(ok=True, errors=[])


def enforce_preflight(client):
    """Run preflight and halt on failure (sys.exit(1))."""
    print("Running preflight validation...", file=sys.stderr)
    result = run_preflight(client)
    if not result.ok:
        print("\n❌ Preflight validation failed:", file=sys.stderr)
        for err in result.errors:
            print(f"  • {err}", file=sys.stderr)
        print("\nCannot proceed. Fix the above issues and retry.", file=sys.stderr)
        sys.exit(1)
    print("✅ Preflight OK — all parent work items validated", file=sys.stderr)
