"""
Feature Progress Skill — Logging Utilities
Sanitized stderr logging: truncation, credential stripping, ID-only references.

Covers: SEC-06
"""

import re
import sys

# Patterns to strip from error messages
_BEARER_RE = re.compile(r"Bearer\s+\S+", re.IGNORECASE)
_PAT_RE = re.compile(r"[a-z0-9]{52}", re.IGNORECASE)

MAX_ERROR_LENGTH = 200


def log(msg: str) -> None:
    """Log a message to stderr with flush."""
    print(msg, file=sys.stderr, flush=True)


def sanitize_err(raw_error: str) -> str:
    """Sanitize an ADO error message for safe logging.

    - Truncates to 200 characters
    - Strips Bearer tokens
    - Strips PAT-pattern substrings (52-char hex)
    """
    if not raw_error:
        return ""
    sanitized = str(raw_error)
    sanitized = _BEARER_RE.sub("[CREDENTIAL_STRIPPED]", sanitized)
    sanitized = _PAT_RE.sub("[CREDENTIAL_STRIPPED]", sanitized)
    if len(sanitized) > MAX_ERROR_LENGTH:
        sanitized = sanitized[:MAX_ERROR_LENGTH] + "..."
    return sanitized
