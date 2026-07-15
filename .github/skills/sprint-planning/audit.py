"""
Durable file-backed audit log for sprint-planning mutations (NFR-006).

Each entry is a JSON line with: timestamp, operation, item_id, field,
old_value, new_value. No tokens, tenant IDs, or full ADO response bodies
are written (SEC-008, R2-STRIDE T-019). Append-only.
"""

import json
import os
import sys
from datetime import datetime, timezone


class AuditLog:
    """Append-only JSONL audit log for ADO mutations."""

    def __init__(self, base_dir: str | None = None):
        if base_dir is None:
            base_dir = os.path.dirname(os.path.abspath(__file__))
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        self.path = os.path.join(base_dir, f"audit-{ts}.jsonl")
        # Create the file immediately so partial runs leave a trace (T-004R)
        with open(self.path, "w", encoding="utf-8") as f:
            header = {
                "event": "session_start",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "version": "1.0",
            }
            f.write(json.dumps(header) + "\n")
        print(f"Audit log: {self.path}", file=sys.stderr)

    def log(
        self,
        operation: str,
        item_id: int | None = None,
        field: str | None = None,
        old_value: str | None = None,
        new_value: str | None = None,
        status: str = "success",
        detail: str | None = None,
    ):
        """Append an audit entry. All values are sanitized before writing."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "operation": _sanitize(operation),
            "item_id": item_id,
            "field": _sanitize(field) if field else None,
            "old_value": _sanitize(str(old_value)) if old_value is not None else None,
            "new_value": _sanitize(str(new_value)) if new_value is not None else None,
            "status": status,
        }
        if detail:
            entry["detail"] = _sanitize(detail)[:500]
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    def log_error(self, operation: str, item_id: int | None, http_status: int | None, message: str):
        """Log a sanitized error entry. Full tracebacks go to stderr only."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "operation": _sanitize(operation),
            "item_id": item_id,
            "http_status": http_status,
            "error": _sanitize(message)[:300],
            "status": "error",
        }
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    def close(self):
        """Write session-end marker."""
        entry = {
            "event": "session_end",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")


def _sanitize(value: str | None) -> str | None:
    """Strip tokens, tenant IDs, and sensitive patterns from audit values (SEC-008)."""
    if value is None:
        return None
    s = str(value)
    # Strip anything that looks like a bearer token (eyJ... base64 patterns > 20 chars)
    import re
    s = re.sub(r'eyJ[A-Za-z0-9_-]{20,}', '[REDACTED_TOKEN]', s)
    # Strip GUIDs that might be tenant/subscription IDs in error contexts
    # (keep work-item-sized integers, just strip long UUID patterns from error messages)
    s = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '[REDACTED_UUID]', s, flags=re.IGNORECASE)
    return s[:1000]  # Hard cap on field length
