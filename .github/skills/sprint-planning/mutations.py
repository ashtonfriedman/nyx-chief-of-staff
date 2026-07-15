"""
Approval gate, pre-write revalidation, and mutation execution for sprint-planning.

Covers: FR-004 (carryover move), FR-005 (carryover report), FR-007 (hierarchy fix),
FR-008 (orphan reparent), FR-009 (bug SP), FR-021 (approval gate), FR-022 (idempotency).
"""

import html
import sys
from dataclasses import dataclass, field
from typing import Any

try:
    from sprint_planning.ado_client import AdoClient, AdoConflictError, AdoNotFoundError, AdoAuthError
    from sprint_planning.audit import AuditLog
    from sprint_planning.preflight import MISC_BUGS_ID
    from sprint_planning.wiql_builder import validate_item_id
except ImportError:
    from ado_client import AdoClient, AdoConflictError, AdoNotFoundError, AdoAuthError
    from audit import AuditLog
    from preflight import MISC_BUGS_ID
    from wiql_builder import validate_item_id


@dataclass
class MutationResult:
    succeeded: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    failed: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------------------
# TTY / Approval Gate (FR-021)
# ---------------------------------------------------------------------------

def check_interactive():
    """Ensure we're running interactively. Fail closed if not (FR-021)."""
    if not sys.stdin.isatty():
        print(
            "❌ sprint-planning must run interactively — "
            "non-interactive mode refuses all mutations.",
            file=sys.stderr,
        )
        sys.exit(1)


def request_approval(summary_lines: list[str], item_ids: list[int] | None = None) -> list[int] | None:
    """Present mutation summary and request approval (FR-021).

    Returns:
        - list of approved item IDs (could be all or subset)
        - None if user skipped/rejected

    Confirmation vocabulary:
        - 'confirm' → approve all
        - 'skip' → reject all
        - comma-separated IDs → approve only those items
    """
    print("\n" + "=" * 60, file=sys.stderr)
    print("PROPOSED CHANGES:", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    for line in summary_lines:
        print(f"  {line}", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(file=sys.stderr)  # blank line separating ADO content from prompt

    if item_ids:
        print(
            f"Enter 'confirm' to approve all {len(item_ids)} changes, "
            "'skip' to reject all, or comma-separated IDs to approve selectively:",
            file=sys.stderr,
        )
    else:
        print("Enter 'confirm' to approve, 'skip' to reject:", file=sys.stderr)

    try:
        response = input("> ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        print("\n⏭ Skipped (no input)", file=sys.stderr)
        return None

    # Input normalization (R2-STRIDE T-017)
    if len(response) > 200:
        print("⚠ Response too long. Please enter 'confirm', 'skip', or item IDs.", file=sys.stderr)
        return None

    # ASCII-only check
    if not response.isascii():
        print("⚠ Non-ASCII input detected. Please enter 'confirm', 'skip', or item IDs.", file=sys.stderr)
        return None

    if response == "confirm":
        return item_ids or []

    if response == "skip":
        return None

    # Try parsing as comma-separated IDs
    if item_ids:
        try:
            selected = []
            for part in response.split(","):
                part = part.strip()
                if part:
                    selected.append(validate_item_id(part))
            if selected:
                # Validate all selected IDs are in the proposed set
                valid = [i for i in selected if i in item_ids]
                if valid:
                    return valid
                print("⚠ None of the provided IDs match proposed changes.", file=sys.stderr)
                return None
        except ValueError:
            pass

    print("⚠ Ambiguous response. Please enter 'confirm', 'skip', or item IDs.", file=sys.stderr)
    return None


# ---------------------------------------------------------------------------
# Pre-write Revalidation (FR-021)
# ---------------------------------------------------------------------------

def revalidate_item(client: AdoClient, item_id: int, expected_revision: int, expected_fields: dict | None = None) -> tuple[bool, dict | None]:
    """Re-read an item's current state before writing (FR-021 pre-write).

    Returns (is_valid, current_item_data).
    is_valid is False if revision changed or critical fields drifted.
    """
    try:
        current = client.get_work_item(item_id)
    except (AdoNotFoundError, AdoAuthError):
        return False, None

    if not current or "fields" not in current:
        return False, None

    current_rev = current.get("rev", 0)
    if current_rev != expected_revision:
        return False, current

    if expected_fields:
        fields = current["fields"]
        for field_name, expected_val in expected_fields.items():
            actual = fields.get(field_name)
            if isinstance(expected_val, str) and isinstance(actual, str):
                if actual != expected_val:
                    return False, current
            elif isinstance(expected_val, dict) and isinstance(actual, dict):
                if actual.get("displayName") != expected_val.get("displayName"):
                    return False, current

    return True, current


# ---------------------------------------------------------------------------
# Mutation Execution
# ---------------------------------------------------------------------------

def execute_carryover(
    client: AdoClient,
    candidates: list,
    next_iteration_path: str,
    audit: AuditLog,
) -> MutationResult:
    """Move carryover candidates to next sprint (FR-004, FR-005)."""
    result = MutationResult()

    for candidate in candidates:
        wi = candidate.item
        item_id = wi.id

        # EC-03: Already in next sprint — skip (idempotency)
        if wi.iteration_path == next_iteration_path:
            result.skipped.append({
                "id": item_id, "reason": "Already in next sprint",
            })
            continue

        # Pre-write revalidation
        valid, current = revalidate_item(
            client, item_id, wi.revision,
            {"System.IterationPath": wi.iteration_path},
        )
        if not valid:
            result.skipped.append({
                "id": item_id, "reason": "Modified since proposal — skipped",
            })
            audit.log("carryover_move", item_id, "System.IterationPath",
                       wi.iteration_path, next_iteration_path, status="skipped",
                       detail="Pre-write revalidation failed")
            continue

        # Get current revision for If-Match
        rev = current.get("rev", wi.revision) if current else wi.revision

        operations = [
            {
                "op": "replace",
                "path": "/fields/System.IterationPath",
                "value": next_iteration_path,
            }
        ]

        try:
            client.patch_work_item(item_id, operations, revision=rev)
            result.succeeded.append({"id": item_id, "title": wi.title})
            audit.log("carryover_move", item_id, "System.IterationPath",
                       wi.iteration_path, next_iteration_path)
        except AdoConflictError:
            result.skipped.append({
                "id": item_id, "reason": "Revision conflict (modified during execution)",
            })
            audit.log_error("carryover_move", item_id, 412, "Revision conflict")
        except AdoNotFoundError:
            result.skipped.append({"id": item_id, "reason": "Item not found (deleted)"})
            audit.log_error("carryover_move", item_id, 404, "Not found")
        except AdoAuthError as e:
            result.failed.append({"id": item_id, "error": "Permission denied"})
            audit.log_error("carryover_move", item_id, 403, str(e))
            raise  # 401/403 stops everything
        except Exception as e:
            result.failed.append({"id": item_id, "error": str(e)[:200]})
            audit.log_error("carryover_move", item_id, None, str(e)[:200])

    return result


def execute_hierarchy_fixes(
    client: AdoClient,
    violations: list,
    audit: AuditLog,
) -> MutationResult:
    """Fix hierarchy violations (FR-007).

    For each violation, issues a single PATCH per FR-007 atomicity requirement:
      - Replace System.Parent to reparent the child under the grandparent (or Misc/Bugs)
      - Add System.LinkTypes.Related back to the original parent, converting the
        former hierarchy link to a Related link as specified in FR-007.

    Using System.Parent field-replace (rather than explicit Hierarchy-Forward/Reverse
    relation removal) is valid per ADO REST API v7.0 — the API atomically removes the
    old hierarchy link and adds the new one when the field is set.  This is functionally
    equivalent to explicit link operations for the parent-change step and results in a
    single PATCH instead of multiple requests.

    The Related link addition is included in the same PATCH to satisfy FR-007's
    "convert the parent-child link to a Related link" requirement atomically.
    """
    result = MutationResult()

    for violation in violations:
        child = violation.child
        parent = violation.parent

        # EC-04: Skip circular hierarchies — manual fix required
        if violation.is_circular:
            result.skipped.append({
                "id": child.id,
                "reason": "Circular hierarchy (manual fix required)",
            })
            audit.log("hierarchy_fix", child.id, status="skipped",
                       detail="Circular hierarchy detected")
            continue

        # Pre-write revalidation
        valid, current = revalidate_item(client, child.id, child.revision)
        if not valid:
            result.skipped.append({
                "id": child.id, "reason": "Modified since proposal — skipped",
            })
            audit.log("hierarchy_fix", child.id, status="skipped",
                       detail="Pre-write revalidation failed")
            continue

        rev = current.get("rev", child.revision) if current else child.revision

        # Build single PATCH per FR-007 atomicity requirement:
        #   1. Replace System.Parent → new parent (handles Hierarchy-Forward/Reverse
        #      link management implicitly via ADO field semantics; the API removes
        #      the old parent-child hierarchy link and adds the new one in one operation)
        #   2. Add System.LinkTypes.Related back to the original parent — this is the
        #      "convert the parent-child link to a Related link" step from FR-007.
        #
        # Using System.Parent (field replace) rather than explicit relation removal +
        # addition is valid per ADO REST API v7.0: setting System.Parent atomically
        # updates the hierarchy links.  The Related link addition is the part the
        # original implementation missed.
        #
        # Idempotency: check whether a Related link to the original parent already
        # exists (could have been added by a prior partial run) before adding again.
        # The revalidate_item call above fetches with $expand=relations so we have it.
        related_url = f"{client.org}/_apis/wit/workItems/{parent.id}"
        existing_relations = (current.get("relations") or []) if current else []
        existing_related_urls = {
            r.get("url", "").rstrip("/").lower()
            for r in existing_relations
            if r.get("rel") == "System.LinkTypes.Related"
        }

        operations: list[dict] = [
            {
                "op": "replace",
                "path": "/fields/System.Parent",
                "value": violation.reparent_target_id,  # int — ADO field is integer
            }
        ]

        # Only add Related link if not already present (FR-022 idempotency)
        if related_url.rstrip("/").lower() not in existing_related_urls:
            operations.append(
                {
                    "op": "add",
                    "path": "/relations/-",
                    "value": {
                        "rel": "System.LinkTypes.Related",
                        "url": related_url,
                        "attributes": {"comment": "Former parent — converted from hierarchy link"},
                    },
                }
            )

        try:
            client.patch_work_item(child.id, operations, revision=rev)
            result.succeeded.append({
                "id": child.id,
                "detail": f"Reparented from {parent.id} to {violation.reparent_target_id}; "
                          f"Related link added to #{parent.id}",
            })
            audit.log("hierarchy_fix", child.id, "System.Parent",
                       str(parent.id), str(violation.reparent_target_id))
        except AdoConflictError:
            result.skipped.append({
                "id": child.id, "reason": "Revision conflict",
            })
            audit.log_error("hierarchy_fix", child.id, 412, "Revision conflict")
        except Exception as e:
            # Partial failure: report for manual intervention (R2-PE NEW-2)
            result.failed.append({
                "id": child.id,
                "error": f"Hierarchy fix failed: {str(e)[:200]}",
            })
            audit.log_error("hierarchy_fix", child.id, None, str(e)[:200])

    return result


def execute_orphan_reparent(
    client: AdoClient,
    orphans: list,
    audit: AuditLog,
) -> MutationResult:
    """Reparent orphaned items under Misc/Bugs (FR-008)."""
    result = MutationResult()

    for wi in orphans:
        # Idempotency: skip if already has a parent
        if wi.parent_id:
            result.skipped.append({"id": wi.id, "reason": "Already has parent"})
            continue

        valid, current = revalidate_item(client, wi.id, wi.revision)
        if not valid:
            result.skipped.append({
                "id": wi.id, "reason": "Modified since proposal — skipped",
            })
            audit.log("orphan_reparent", wi.id, status="skipped",
                       detail="Pre-write revalidation failed")
            continue

        rev = current.get("rev", wi.revision) if current else wi.revision

        operations = [
            {
                "op": "add",
                "path": "/fields/System.Parent",
                "value": str(MISC_BUGS_ID),
            }
        ]

        try:
            client.patch_work_item(wi.id, operations, revision=rev)
            result.succeeded.append({"id": wi.id, "title": wi.title})
            audit.log("orphan_reparent", wi.id, "System.Parent",
                       "None", str(MISC_BUGS_ID))
        except AdoConflictError:
            result.skipped.append({"id": wi.id, "reason": "Revision conflict"})
            audit.log_error("orphan_reparent", wi.id, 412, "Revision conflict")
        except Exception as e:
            result.failed.append({"id": wi.id, "error": str(e)[:200]})
            audit.log_error("orphan_reparent", wi.id, None, str(e)[:200])

    return result


def execute_bug_sp_enforcement(
    client: AdoClient,
    uncosted: list,
    audit: AuditLog,
) -> MutationResult:
    """Set SP=1 on uncosted bugs (FR-009)."""
    result = MutationResult()

    for wi in uncosted:
        # Idempotency: skip if already has SP >= 1
        if wi.story_points and wi.story_points >= 1:
            result.skipped.append({"id": wi.id, "reason": "Already has SP"})
            continue

        valid, current = revalidate_item(client, wi.id, wi.revision)
        if not valid:
            result.skipped.append({
                "id": wi.id, "reason": "Modified since proposal — skipped",
            })
            continue

        rev = current.get("rev", wi.revision) if current else wi.revision

        operations = [
            {
                "op": "add",
                "path": "/fields/Microsoft.VSTS.Scheduling.StoryPoints",
                "value": 1,
            }
        ]

        try:
            client.patch_work_item(wi.id, operations, revision=rev)
            result.succeeded.append({"id": wi.id, "title": wi.title})
            audit.log("bug_sp_set", wi.id, "StoryPoints",
                       str(wi.story_points), "1")
        except AdoConflictError:
            result.skipped.append({"id": wi.id, "reason": "Revision conflict"})
            audit.log_error("bug_sp_set", wi.id, 412, "Revision conflict")
        except Exception as e:
            result.failed.append({"id": wi.id, "error": str(e)[:200]})
            audit.log_error("bug_sp_set", wi.id, None, str(e)[:200])

    return result


def check_abort_threshold(results: list[MutationResult], structural: bool = True) -> bool:
    """Check if skipped structural mutations exceed 50% threshold (FR-021).

    Returns True if batch should be aborted.
    """
    if not structural:
        return False

    total_proposed = 0
    total_skipped = 0
    for r in results:
        total_proposed += len(r.succeeded) + len(r.skipped) + len(r.failed)
        total_skipped += len(r.skipped)

    if total_proposed == 0:
        return False

    skip_pct = total_skipped / total_proposed
    return skip_pct > 0.5


def report_results(label: str, result: MutationResult):
    """Print mutation result summary."""
    print(f"\n📋 {label}:", file=sys.stderr)
    if result.succeeded:
        print(f"  ✅ {len(result.succeeded)} succeeded", file=sys.stderr)
        for item in result.succeeded[:10]:
            title = html.escape(str(item.get("title", "")))[:60]
            print(f"     #{item['id']} {title}", file=sys.stderr)
    if result.skipped:
        print(f"  ⏭ {len(result.skipped)} skipped", file=sys.stderr)
        for item in result.skipped[:10]:
            print(f"     #{item['id']}: {item['reason']}", file=sys.stderr)
    if result.failed:
        print(f"  ❌ {len(result.failed)} failed", file=sys.stderr)
        for item in result.failed[:5]:
            print(f"     #{item['id']}: {item.get('error', 'unknown')}", file=sys.stderr)
