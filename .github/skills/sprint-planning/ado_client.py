"""
ADO REST API client for sprint-planning skill.

Handles token acquisition, batch work item fetch, PATCH with If-Match,
and HTTP error routing per FR-024. Tokens are never written to disk or logs
(SEC-001–SEC-003).
"""

import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from typing import Any

AZ_CMD = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
# Configure your org/project via the ADO_ORG / ADO_PROJECT / ADO_AREA env vars (or memory.md)
ADO_ORG = os.environ.get("ADO_ORG", "https://dev.azure.com/{your-org}")
ADO_PROJECT = os.environ.get("ADO_PROJECT", "{your-project}")
ADO_AREA = os.environ.get("ADO_AREA", "{your-area-path}")
ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798"
API_VERSION = "7.0"
BATCH_CHUNK_SIZE = 200

# Import sibling module
try:
    from sprint_planning.wiql_builder import validate_item_id
except ImportError:
    from wiql_builder import validate_item_id


class AdoAuthError(Exception):
    """401/403 — stop immediately, no retry."""
    pass


class AdoNotFoundError(Exception):
    """404 — item is stale/deleted."""
    pass


class AdoConflictError(Exception):
    """409/412 — revision conflict."""
    pass


class AdoRateLimitError(Exception):
    """429 — rate limited."""
    pass


class AdoServerError(Exception):
    """5xx — transient server error."""
    pass


class AdoClient:
    """REST client for Azure DevOps work item operations."""

    def __init__(self, org: str = ADO_ORG, project: str = ADO_PROJECT):
        self.org = org
        self.project = project
        self._token: str | None = None
        self._token_time: float = 0

    def _get_token(self) -> str:
        """Acquire a fresh token via az CLI. Never cached to disk (SEC-003)."""
        result = subprocess.run(
            [AZ_CMD, "account", "get-access-token",
             "--resource", ADO_RESOURCE],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode != 0:
            raise AdoAuthError(f"az CLI token acquisition failed: exit {result.returncode}")
        try:
            data = json.loads(result.stdout)
            token = data["accessToken"]
            self._token = token
            self._token_time = time.time()
            return token
        except (json.JSONDecodeError, KeyError):
            raise AdoAuthError("Failed to parse access token from az CLI")

    @property
    def token(self) -> str:
        """Return current token, refreshing if older than 45 minutes (EC-09)."""
        if self._token is None or (time.time() - self._token_time > 2700):
            return self._get_token()
        return self._token

    def _refresh_token_and_retry(self):
        """Force token refresh on 401 during mid-run (EC-09)."""
        self._token = None
        return self._get_token()

    def _request(
        self,
        method: str,
        url: str,
        body: bytes | None = None,
        content_type: str = "application/json",
        headers: dict | None = None,
        retries: int = 3,
        is_write: bool = False,
    ) -> dict | None:
        """Execute an HTTP request with error routing per FR-024."""
        all_headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": content_type,
        }
        if headers:
            all_headers.update(headers)

        last_error = None
        for attempt in range(retries + 1):
            req = urllib.request.Request(url, data=body, method=method, headers=all_headers)
            try:
                resp = urllib.request.urlopen(req, timeout=30)
                raw = resp.read().decode("utf-8-sig")
                if not raw.strip():
                    return {}
                return json.loads(raw, strict=False)
            except urllib.error.HTTPError as e:
                status = e.code
                if status in (401, 403):
                    if attempt == 0:
                        # Try token refresh once (EC-09)
                        try:
                            self._refresh_token_and_retry()
                            all_headers["Authorization"] = f"Bearer {self.token}"
                            continue
                        except AdoAuthError:
                            pass
                    raise AdoAuthError(f"HTTP {status}: Permission denied")
                elif status == 404:
                    raise AdoNotFoundError(f"HTTP 404: Resource not found")
                elif status in (409, 412):
                    raise AdoConflictError(f"HTTP {status}: Revision conflict")
                elif status == 429:
                    if attempt < retries:
                        delay = (2 ** attempt) + random.uniform(0, 1)
                        print(f"  Rate limited, retrying in {delay:.1f}s...", file=sys.stderr)
                        time.sleep(delay)
                        last_error = e
                        continue
                    raise AdoRateLimitError(f"HTTP 429: Rate limited after {retries} retries")
                elif status >= 500:
                    if attempt < retries:
                        delay = (2 ** attempt) + random.uniform(0, 1)
                        print(f"  Server error {status}, retrying in {delay:.1f}s...", file=sys.stderr)
                        time.sleep(delay)
                        last_error = e
                        continue
                    raise AdoServerError(f"HTTP {status}: Server error after {retries} retries")
                else:
                    raise
            except (urllib.error.URLError, TimeoutError, OSError) as e:
                if attempt < retries and not is_write:
                    delay = (2 ** attempt) + random.uniform(0, 1)
                    time.sleep(delay)
                    last_error = e
                    continue
                raise

        if last_error:
            raise last_error
        return None

    def _api_url(self, path: str) -> str:
        proj = urllib.parse.quote(self.project, safe="")
        return f"{self.org}/{proj}/_apis/{path}"

    def get_work_item(self, item_id: int, fields: list[str] | None = None) -> dict:
        """Fetch a single work item by ID."""
        item_id = validate_item_id(item_id)
        url = self._api_url(f"wit/workitems/{item_id}?api-version={API_VERSION}")
        if fields:
            field_param = ",".join(fields)
            url += f"&fields={urllib.parse.quote(field_param)}"
        url += "&$expand=relations"
        return self._request("GET", url)

    def get_work_items_batch(self, ids: list[int], fields: list[str] | None = None) -> list[dict]:
        """Batch-fetch work items in chunks of BATCH_CHUNK_SIZE (EC-06)."""
        validated_ids = [validate_item_id(i) for i in ids]
        all_items = []
        for start in range(0, len(validated_ids), BATCH_CHUNK_SIZE):
            chunk = validated_ids[start:start + BATCH_CHUNK_SIZE]
            id_str = ",".join(str(i) for i in chunk)
            url = self._api_url(
                f"wit/workitems?ids={id_str}&api-version={API_VERSION}&$expand=relations"
            )
            if fields:
                url += f"&fields={urllib.parse.quote(','.join(fields))}"
            data = self._request("GET", url)
            if data and "value" in data:
                all_items.extend(data["value"])
            print(
                f"  Fetched {min(start + BATCH_CHUNK_SIZE, len(validated_ids))}/{len(validated_ids)} items...",
                file=sys.stderr, flush=True,
            )
        return all_items

    def query_wiql(self, wiql: str) -> list[int]:
        """Execute a WIQL query and return matching work item IDs."""
        url = self._api_url(f"wit/wiql?api-version={API_VERSION}")
        body = json.dumps({"query": wiql}).encode("utf-8")
        data = self._request("POST", url, body=body)
        if not data or "workItems" not in data:
            return []
        return [wi["id"] for wi in data["workItems"]]

    def patch_work_item(
        self,
        item_id: int,
        operations: list[dict],
        revision: int | None = None,
    ) -> dict:
        """PATCH a work item with json-patch+json operations.

        Uses If-Match with revision for optimistic concurrency (T-016).
        Body encoded as UTF-8 bytes per spec.
        """
        item_id = validate_item_id(item_id)
        url = self._api_url(f"wit/workitems/{item_id}?api-version={API_VERSION}")
        body = json.dumps(operations).encode("utf-8")
        headers = {}
        if revision is not None:
            headers["If-Match"] = str(revision)
        return self._request(
            "PATCH", url, body=body,
            content_type="application/json-patch+json",
            headers=headers,
            is_write=True,
            retries=0,  # Writes: no blind retry; caller handles revalidation
        )

    def get_team_iterations(self, team: str = None) -> list[dict]:
        """Fetch the team's configured iteration schedule."""
        if team is None:
            team = os.environ.get("ADO_TEAM", "{your-team}")
        team_enc = urllib.parse.quote(team, safe="")
        proj = urllib.parse.quote(self.project, safe="")
        url = f"{self.org}/{proj}/{team_enc}/_apis/work/teamsettings/iterations?api-version={API_VERSION}"
        data = self._request("GET", url)
        if data and "value" in data:
            return data["value"]
        return []
