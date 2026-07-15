"""
Feature Progress Skill — Security Utilities
HTML entity encoding, integer ID validation, safe URL construction,
WIQL-safe ID list construction.

Covers: SEC-05, SEC-07
"""

import re
import sys

from constants import ADO_URL_TEMPLATE

# HTML entity map — covers the five characters that matter for XSS prevention
_HTML_ESCAPE_TABLE = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#x27;",
}

_HTML_ESCAPE_RE = re.compile(r"[&<>\"']")

_VALID_ID_RE = re.compile(r"^[0-9]+$")


def html_escape(s: str) -> str:
    """HTML-entity-encode a string. Safe for insertion into HTML content/attributes."""
    if not s:
        return ""
    return _HTML_ESCAPE_RE.sub(lambda m: _HTML_ESCAPE_TABLE[m.group()], str(s))


def validate_id(raw) -> int | None:
    """Validate a work item ID as a positive integer.

    Returns the integer if valid, None otherwise.
    Logs anomaly to stderr on validation failure.
    """
    raw_str = str(raw).strip() if raw is not None else ""
    if not raw_str or not _VALID_ID_RE.match(raw_str):
        print(
            f"[SECURITY] Invalid work item ID rejected: {html_escape(raw_str[:50])}",
            file=sys.stderr,
            flush=True,
        )
        return None
    val = int(raw_str)
    if val <= 0:
        print(
            f"[SECURITY] Non-positive work item ID rejected: {val}",
            file=sys.stderr,
            flush=True,
        )
        return None
    return val


def build_ado_url(validated_id: int) -> str:
    """Build an ADO work item URL from a validated integer ID."""
    return ADO_URL_TEMPLATE.format(id=int(validated_id))


def wiql_safe_id_list(ids: list[int]) -> str:
    """Produce a comma-separated list of validated integer IDs for WIQL IN clauses.

    Only accepts integers. Returns empty string if no valid IDs.
    """
    safe = []
    for raw_id in ids:
        if isinstance(raw_id, int) and raw_id > 0:
            safe.append(str(raw_id))
        else:
            validated = validate_id(raw_id)
            if validated is not None:
                safe.append(str(validated))
    return ",".join(safe)
