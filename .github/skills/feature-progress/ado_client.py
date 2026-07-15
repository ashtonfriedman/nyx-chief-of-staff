"""
Feature Progress Skill — ADO Client
WIQL execution, batch work item fetch, relation expansion, token management.
Wraps patterns from ado-query/query.py with security hardening.

Covers: NFR-02, NFR-03, SEC-01, SEC-06
"""

import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request

from constants import AZ_CMD, ORG, PROJECT
from log_utils import log, sanitize_err
from security_utils import validate_id


def get_token() -> str | None:
    """Get an ADO access token via az CLI. No credentials in args (SEC-01)."""
    try:
        result = subprocess.run(
            [AZ_CMD, "account", "get-access-token",
             "--resource", "499b84ac-1321-427f-aa17-267ca6975798"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            log(f"Token fetch failed: {sanitize_err(result.stderr)}")
            return None
        return json.loads(result.stdout).get("accessToken")
    except Exception as e:
        log(f"Token fetch exception: {sanitize_err(str(e))}")
        return None


def _run_az(args: list[str]) -> dict | list | None:
    """Run an az CLI command and return parsed JSON."""
    try:
        result = subprocess.run(
            [AZ_CMD] + args,
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            log(f"az error: {sanitize_err(result.stderr)}")
            return None
        raw = re.sub(r"[\x00-\x1f]", " ", result.stdout)
        return json.loads(raw, strict=False)
    except subprocess.TimeoutExpired:
        log("az command timed out")
        return None
    except json.JSONDecodeError as e:
        log(f"JSON parse error: {sanitize_err(str(e))}")
        return None


def run_wiql(wiql: str, org: str = ORG, project: str = PROJECT) -> list[int]:
    """Execute a WIQL query and return a list of work item IDs."""
    data = _run_az([
        "boards", "query",
        "--wiql", wiql,
        "--org", org,
        "--project", project,
        "-o", "json",
    ])
    if not data:
        return []
    ids = []
    for item in data:
        if "fields" in item:
            raw_id = item["fields"].get("System.Id")
            validated = validate_id(raw_id)
            if validated is not None:
                ids.append(validated)
        elif "id" in item:
            validated = validate_id(item["id"])
            if validated is not None:
                ids.append(validated)
    return ids


def fetch_batch(
    ids: list[int], org: str = ORG, project: str = PROJECT,
    fields: list[str] | None = None,
) -> list[dict]:
    """Batch-fetch work items via REST API (200 per chunk, CLI fallback)."""
    if not ids:
        return []

    token = get_token()
    if not token:
        log("No token available, falling back to CLI fetch")
        return _fetch_cli(ids)

    items = []
    chunk_size = 200
    total = len(ids)
    for start in range(0, total, chunk_size):
        chunk = ids[start:start + chunk_size]
        id_str = ",".join(str(i) for i in chunk)
        url = (
            f"{org}/{urllib.parse.quote(project, safe='')}/"
            f"_apis/wit/workitems?ids={id_str}&api-version=7.0"
        )
        if fields:
            field_str = ",".join(fields)
            url += f"&fields={urllib.parse.quote(field_str, safe=',')}"

        req = urllib.request.Request(
            url, headers={"Authorization": f"Bearer {token}"}
        )
        try:
            resp = urllib.request.urlopen(req, timeout=60)
            raw = resp.read().decode("utf-8-sig")
            data = json.loads(raw, strict=False)
            items.extend(data.get("value", []))
            log(f"  Fetched {min(start + chunk_size, total)}/{total} items...")
        except Exception as e:
            log(f"REST batch failed: {sanitize_err(str(e))}")
            log("Falling back to CLI for this chunk")
            items.extend(_fetch_cli(chunk))
    return items


def fetch_with_relations(
    work_item_id: int, org: str = ORG, project: str = PROJECT,
) -> dict | None:
    """Fetch a single work item with $expand=relations."""
    token = get_token()
    if not token:
        return _fetch_single_cli(work_item_id)

    url = (
        f"{org}/{urllib.parse.quote(project, safe='')}/"
        f"_apis/wit/workitems/{work_item_id}?$expand=relations&api-version=7.0"
    )
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}"}
    )
    try:
        resp = urllib.request.urlopen(req, timeout=60)
        raw = resp.read().decode("utf-8-sig")
        return json.loads(raw, strict=False)
    except Exception as e:
        log(f"Relation fetch failed for WI {work_item_id}: {sanitize_err(str(e))}")
        return _fetch_single_cli(work_item_id)


def _fetch_cli(ids: list[int]) -> list[dict]:
    """Fallback: fetch items one at a time via az CLI."""
    items = []
    for i, wid in enumerate(ids):
        item = _fetch_single_cli(wid)
        if item:
            items.append(item)
        if (i + 1) % 20 == 0:
            log(f"  CLI fallback fetched {i + 1}/{len(ids)}...")
    return items


def _fetch_single_cli(wid: int) -> dict | None:
    """Fetch a single work item via az CLI."""
    return _run_az([
        "boards", "work-item", "show",
        "--id", str(int(wid)),
        "-o", "json",
    ])
