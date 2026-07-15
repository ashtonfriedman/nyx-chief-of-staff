# Python: <repo>\AppData\Local\Programs\Python\Python312\python.exe
#!/usr/bin/env python3
"""
Team Health Dashboard — Data Collector

Queries ADO for all active work items in {your-area-path} area path,
enriches with date fields, relations (PR links, child tasks),
and pulls PR data from Azure DevOps Git API.

Uses ADO REST API directly with batch fetching (200 items/request)
instead of per-item az CLI calls. ~130 items in <30s vs 15+ minutes.

Outputs structured JSON for the dashboard renderer.

Usage:
  python collect.py                          # defaults: {your-area-path}, active items
  python collect.py --area "Other\\Path"     # different area
  python collect.py --include-prs            # also fetch PR data
  python collect.py --output data/team-data.json
  python collect.py --sprint-config sprint-config.json  # velocity from previous sprint
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone


def find_az_cmd():
    """Find Azure CLI executable, trying PATH first then known Windows locations."""
    az_path = shutil.which('az') or shutil.which('az.cmd')
    if az_path:
        return az_path
    candidates = [
        r"C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
        r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return 'az'


AZ_CMD = find_az_cmd()
API_VERSION = "7.0"
BATCH_SIZE = 200

# Defaults — overridden by sprint-config.json "ado" section at runtime
_DEFAULT_ADO = {
    "org": "https://dev.azure.com/{your-org}",
    "project": "{your-project}",
    "areaPath": r"{your-area-path}",
    "repoName": "{your-repo}",
}


# --- Timing helper ---

def timed(label):
    """Context manager that prints elapsed time to stderr."""
    class Timer:
        def __enter__(self):
            self.start = time.perf_counter()
            return self
        def __exit__(self, *args):
            elapsed = time.perf_counter() - self.start
            print(f"  ⏱ {label}: {elapsed:.1f}s", file=sys.stderr)
    return Timer()


# --- Auth & HTTP ---

class TokenManager:
    """Manages ADO/Graph bearer tokens with automatic refresh before expiry."""

    def __init__(self, resource, label="ADO"):
        self._resource = resource
        self._label = label
        self._token = None
        self._expires_at = 0  # epoch seconds

    def get(self):
        """Return a valid token, refreshing if within 5 minutes of expiry."""
        if self._token and time.time() < self._expires_at - 300:
            return self._token
        self._refresh()
        return self._token

    def _refresh(self):
        result = subprocess.run(
            [AZ_CMD, "account", "get-access-token",
             "--resource", self._resource, "-o", "json"],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"  {self._label} auth error: {result.stderr.strip()}", file=sys.stderr)
            if not self._token:
                sys.exit(1)
            print(f"  Continuing with existing {self._label} token.", file=sys.stderr)
            return
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            print(f"  {self._label} auth: unparseable response.", file=sys.stderr)
            if not self._token:
                sys.exit(1)
            return
        self._token = data.get("accessToken", "").strip()
        if not self._token:
            print(f"  {self._label} auth: empty token.", file=sys.stderr)
            sys.exit(1)
        expires_on = data.get("expiresOn", "")
        if expires_on:
            try:
                dt = datetime.fromisoformat(expires_on.replace("Z", "+00:00"))
                self._expires_at = dt.timestamp()
                remaining = int(self._expires_at - time.time())
                print(f"  {self._label} token refreshed (expires in {remaining}s).", file=sys.stderr)
            except (ValueError, TypeError):
                self._expires_at = time.time() + 3000  # assume ~50 min if unparseable
        else:
            self._expires_at = time.time() + 3000

_ado_tokens = TokenManager("499b84ac-1321-427f-aa17-267ca6975798", "ADO")
_graph_tokens = TokenManager("https://graph.microsoft.com", "Graph")


def get_ado_token():
    """Get a Bearer token for ADO via az CLI (with auto-refresh)."""
    return _ado_tokens.get()


def get_graph_token():
    """Get a Bearer token for Microsoft Graph via az CLI (with auto-refresh)."""
    try:
        return _graph_tokens.get()
    except SystemExit:
        return None


def graph_get(url, headers):
    """HTTP GET against Microsoft Graph, returning parsed JSON."""
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  Graph HTTP {e.code} on GET {url}\n  {body[:300]}", file=sys.stderr)
        return None


def build_roster_from_graph(roster_seeds, graph_headers):
    """Build roster dynamically from Graph org structure.
    
    All derived from /me — no hardcoded UPNs:
      /me                      → the calling user (my-team, manager)
      /me/directReports        → my directs (my-team, direct)
      /me/manager              → skip-level manager
      /me/manager/directReports → peer managers + their reports (peer group)
    
    roster_seeds in sprint-config.json:
      { "peerGroupName": "peer-group", "overrides": {"Display Name": {"note": "..."}} }
    """
    roster = {}
    overrides = roster_seeds.get("overrides", {})
    peer_group = roster_seeds.get("peerGroupName", "peer-team")

    def add(name, group, rel):
        if not name:
            return
        # Skip service/test accounts (e.g., "Name (NON EA SC ALT)")
        if "(" in name and ")" in name:
            return
        entry = {"group": group, "rel": rel}
        entry.update(overrides.get(name, {}))
        roster[name] = entry

    # 1. Me
    me = graph_get("https://graph.microsoft.com/v1.0/me?$select=displayName,id", graph_headers)
    if not me:
        print("  Graph: /me failed, cannot build roster.", file=sys.stderr)
        return None
    my_name = me.get("displayName", "")
    my_id = me.get("id", "")
    add(my_name, "my-team", "manager")

    # 2. My direct reports
    directs = graph_get("https://graph.microsoft.com/v1.0/me/directReports?$select=displayName,id,accountEnabled", graph_headers)
    direct_count = 0
    if directs and "value" in directs:
        for p in directs["value"]:
            if not p.get("accountEnabled", True):
                continue
            add(p.get("displayName", ""), "my-team", "direct")
            direct_count += 1
    print(f"  Graph: {direct_count} direct reports.", file=sys.stderr)

    # 3. My manager (skip-level) — include in peer group as manager
    mgr = graph_get("https://graph.microsoft.com/v1.0/me/manager?$select=displayName,id", graph_headers)
    if not mgr:
        print("  Graph: /me/manager failed, skipping peer teams.", file=sys.stderr)
        return roster
    mgr_name = mgr.get("displayName", "")
    mgr_id = mgr.get("id", "")
    add(mgr_name, peer_group, "manager")

    # 4. Manager's direct reports (my peers) — exclude me
    peers = graph_get(
        f"https://graph.microsoft.com/v1.0/users/{mgr_id}/directReports?$select=displayName,id,accountEnabled",
        graph_headers)
    peer_ids = []
    if peers and "value" in peers:
        for p in peers["value"]:
            if not p.get("accountEnabled", True):
                continue
            pid = p.get("id", "")
            if pid == my_id:
                continue
            add(p.get("displayName", ""), peer_group, "peer")
            peer_ids.append(pid)
        print(f"  Graph: {len(peer_ids)} peers under {mgr_name}.", file=sys.stderr)

    # 5. Each peer's direct reports (the people ON the peer teams)
    peer_report_count = 0
    for pid in peer_ids:
        reports = graph_get(
            f"https://graph.microsoft.com/v1.0/users/{pid}/directReports?$select=displayName,id,accountEnabled",
            graph_headers)
        if reports and "value" in reports:
            for p in reports["value"]:
                if not p.get("accountEnabled", True):
                    continue
                add(p.get("displayName", ""), peer_group, "peer")
                peer_report_count += 1
    if peer_report_count:
        print(f"  Graph: {peer_report_count} reports across peer managers.", file=sys.stderr)

    return roster


def ado_get(url, headers):
    """HTTP GET returning parsed JSON."""
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  HTTP {e.code} on GET {url}\n  {body[:300]}", file=sys.stderr)
        return None


def ado_post(url, headers, body):
    """HTTP POST returning parsed JSON."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        print(f"  HTTP {e.code} on POST {url}\n  {err_body[:300]}", file=sys.stderr)
        return None


# --- Utility ---

def days_since(date_str):
    """Calculate days between a date string and now. Returns None if no date."""
    if not date_str or date_str == '0001-01-01T00:00:00Z':
        return None
    try:
        dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
        delta = datetime.now(timezone.utc) - dt
        return round(delta.total_seconds() / 86400, 1)
    except (ValueError, TypeError):
        return None


# --- Work Item Pipeline ---

_SAFE_ADO_PATH = re.compile(r"^[A-Za-z0-9 _\-\\/()\u00C0-\u024F.]+$")


def validate_ado_path(value, label="path"):
    """Validate that a value is safe for WIQL string interpolation."""
    if not value or not _SAFE_ADO_PATH.match(value):
        raise ValueError(f"Invalid ADO {label}: {value!r}")
    if "'" in value:
        raise ValueError(f"ADO {label} contains single quote: {value!r}")
    return value


def build_wiql(area, states=None, iteration_path=None):
    validate_ado_path(area, "area path")
    conditions = [f"[System.AreaPath] UNDER '{area}'"]
    if iteration_path:
        validate_ado_path(iteration_path, "iteration path")
        conditions.append(f"[System.IterationPath] = '{iteration_path}'")
    if states:
        for s in states:
            validate_ado_path(s, "state value")
        state_list = "', '".join(states)
        conditions.append(f"[System.State] IN ('{state_list}')")
    else:
        conditions.append("[System.State] NOT IN ('Closed', 'Removed')")
    where = " AND ".join(conditions)
    return f"SELECT [System.Id] FROM WorkItems WHERE {where} ORDER BY [System.AssignedTo], [System.WorkItemType]"


def fetch_work_item_ids_rest(wiql, org, project, headers):
    """Run a WIQL query via REST and return a list of work item IDs."""
    url = f"{org}/{urllib.parse.quote(project, safe='')}/_apis/wit/wiql?api-version={API_VERSION}"
    body = {"query": wiql}
    data = ado_post(url, headers, body)
    if not data:
        return []
    return [item["id"] for item in data.get("workItems", [])]


def fetch_work_items_batch(ids, org, project, headers):
    """Fetch work items in batches of 200 with relations expanded."""
    all_items = []
    for i in range(0, len(ids), BATCH_SIZE):
        chunk = ids[i:i + BATCH_SIZE]
        id_str = ",".join(str(wid) for wid in chunk)
        url = (f"{org}/{urllib.parse.quote(project, safe='')}/_apis/wit/workitems"
               f"?ids={id_str}&$expand=relations&api-version={API_VERSION}")
        resp = ado_get(url, headers)
        if resp and "value" in resp:
            all_items.extend(resp["value"])
            print(f"  Batch {i // BATCH_SIZE + 1}: {len(resp['value'])} items", file=sys.stderr)
        else:
            print(f"  Batch {i // BATCH_SIZE + 1}: FAILED", file=sys.stderr)
    return all_items


# Need urllib.parse for URL encoding
import urllib.parse


def extract_work_item(item):
    """Extract enriched fields from a full work item response."""
    f = item.get('fields', {})
    relations = item.get('relations', []) or []

    assigned = ''
    assigned_obj = f.get('System.AssignedTo')
    if assigned_obj and isinstance(assigned_obj, dict):
        assigned = assigned_obj.get('displayName', '')

    pr_links = []
    child_ids = []
    for rel in relations:
        rel_type = rel.get('rel', '')
        url = rel.get('url', '')
        attrs = rel.get('attributes', {})

        if rel_type == 'ArtifactLink' and 'vstfs:///Git/PullRequestId' in url:
            pr_links.append({
                'url': url,
                'name': attrs.get('name', 'Pull Request'),
            })
        elif rel_type == 'System.LinkTypes.Hierarchy-Forward':
            match = re.search(r'/workItems/(\d+)$', url)
            if match:
                child_ids.append(int(match.group(1)))

    created = f.get('System.CreatedDate', '')
    activated = f.get('Microsoft.VSTS.Common.ActivatedDate', '')
    state_changed = f.get('Microsoft.VSTS.Common.StateChangeDate', '')
    changed = f.get('System.ChangedDate', '')
    assigned_date = f.get('System.AuthorizedDate', '') or f.get('Microsoft.VSTS.Common.ActivatedDate', '')

    return {
        'id': f.get('System.Id', item.get('id', '')),
        'type': f.get('System.WorkItemType', ''),
        'state': f.get('System.State', ''),
        'priority': f.get('Microsoft.VSTS.Common.Priority', ''),
        'title': str(f.get('System.Title', '')).strip(),
        'tags': str(f.get('System.Tags', '') or ''),
        'assigned': assigned,
        'parent': f.get('System.Parent', ''),
        'iteration': f.get('System.IterationPath', ''),
        'area': f.get('System.AreaPath', ''),
        'storyPoints': f.get('Microsoft.VSTS.Scheduling.StoryPoints'),
        'dates': {
            'created': created,
            'activated': activated,
            'stateChanged': state_changed,
            'changed': changed,
            'assigned': assigned_date,
        },
        'age': {
            'sinceCreated': days_since(created),
            'sinceActivated': days_since(activated),
            'sinceStateChange': days_since(state_changed),
            'sinceChanged': days_since(changed),
            'sinceAssigned': days_since(assigned_date),
        },
        'linkedPRs': pr_links,
        'childIds': child_ids,
        'prCount': len(pr_links),
        'childCount': len(child_ids),
        'commentCount': f.get('System.CommentCount', 0),
    }


# --- PR Pipeline ---

def fetch_prs_rest(org, project, repo_name, status, headers):
    """Fetch PRs from Azure DevOps Git REST API in a single call."""
    url = (f"{org}/{urllib.parse.quote(project, safe='')}/_apis/git"
           f"/repositories/{urllib.parse.quote(repo_name, safe='')}"
           f"/pullrequests?searchCriteria.status={status}&api-version={API_VERSION}")
    data = ado_get(url, headers)
    if not data:
        return []
    return data.get("value", [])


def extract_pr(pr):
    """Extract useful fields from a PR response."""
    created_by = pr.get('createdBy', {})
    reviewers = pr.get('reviewers', []) or []
    repo = pr.get('repository', {})

    return {
        'id': pr.get('pullRequestId', ''),
        'title': pr.get('title', '').strip(),
        'status': pr.get('status', ''),
        'createdDate': pr.get('creationDate', ''),
        'closedDate': pr.get('closedDate', ''),
        'createdBy': created_by.get('displayName', ''),
        'repository': repo.get('name', ''),
        'sourceBranch': pr.get('sourceRefName', '').replace('refs/heads/', ''),
        'targetBranch': pr.get('targetRefName', '').replace('refs/heads/', ''),
        'reviewers': [
            {
                'name': r.get('displayName', ''),
                'vote': r.get('vote', 0),
            }
            for r in reviewers
        ],
        'age': days_since(pr.get('creationDate', '')),
        'isDraft': pr.get('isDraft', False),
    }


# --- Assembly ---

def build_dashboard_data(work_items, prs, area_path):
    """Assemble the dashboard JSON structure."""
    # Group work items by assigned person
    people = defaultdict(lambda: {'workItems': [], 'pullRequests': [], 'metrics': {}})

    for wi in work_items:
        person = wi['assigned'] or 'Unassigned'
        people[person]['workItems'].append(wi)

    # Group PRs by creator
    for pr in prs:
        person = pr['createdBy']
        if person in people:
            people[person]['pullRequests'].append(pr)
        else:
            people[person]['pullRequests'].append(pr)

    # Compute per-person metrics
    for name, data in people.items():
        wis = data['workItems']
        prs_list = data['pullRequests']

        state_ages = [wi['age']['sinceStateChange'] for wi in wis if wi['age']['sinceStateChange'] is not None]
        pr_ages = [pr['age'] for pr in prs_list if pr['age'] is not None]

        data['metrics'] = {
            'activeItems': len(wis),
            'byState': dict(defaultdict(int, **{s: 0 for s in ['New', 'Active', 'Resolved']})),
            'avgDaysInState': round(sum(state_ages) / len(state_ages), 1) if state_ages else 0,
            'maxDaysInState': round(max(state_ages), 1) if state_ages else 0,
            'itemsWithNoPR': sum(1 for wi in wis if wi['prCount'] == 0 and wi['type'] in ('User Story', 'Bug')),
            'openPRs': len([p for p in prs_list if p['status'] == 'active']),
            'avgPRAge': round(sum(pr_ages) / len(pr_ages), 1) if pr_ages else 0,
        }

        # State breakdown
        state_counts = defaultdict(int)
        for wi in wis:
            state_counts[wi['state']] += 1
        data['metrics']['byState'] = dict(state_counts)

    # Summary
    total_items = sum(len(d['workItems']) for d in people.values())
    total_prs = sum(len(d['pullRequests']) for d in people.values())

    return {
        'meta': {
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'areaPath': area_path,
            'itemCount': total_items,
            'prCount': total_prs,
        },
        'summary': {
            'totalItems': total_items,
            'totalPRs': total_prs,
        },
        'people': {name: data for name, data in sorted(people.items())},
    }


def load_sprint_config(path):
    """Load sprint-config.json if it exists. Returns dict or None."""
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, 'r') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        print(f"  Warning: failed to read sprint config {path}: {e}", file=sys.stderr)
        return None


def build_previous_sprint_data(work_items, sprint_name):
    """Group closed/resolved items by person for velocity tracking."""
    people = defaultdict(lambda: {'workItems': [], 'metrics': {}})
    for wi in work_items:
        person = wi['assigned'] or 'Unassigned'
        people[person]['workItems'].append(wi)

    for name, data in people.items():
        wis = data['workItems']
        total_points = sum(wi.get('storyPoints') or 0 for wi in wis)
        data['metrics'] = {
            'closedItems': len(wis),
            'totalPoints': total_points,
        }

    return {
        'name': sprint_name,
        'people': {name: data for name, data in sorted(people.items())},
    }


def main():
    overall_start = time.perf_counter()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    default_sprint_config = os.path.join(script_dir, 'sprint-config.json')

    parser = argparse.ArgumentParser(description='Team Health Dashboard — Data Collector')
    parser.add_argument('--area', '-a', default=None, help='Area path (UNDER match)')
    parser.add_argument('--include-prs', action='store_true', help='Also fetch PR data')
    parser.add_argument('--pr-status', default='active', choices=['active', 'completed', 'all'],
                        help='PR status filter')
    parser.add_argument('--output', '-o', default='data/team-data.json', help='Output JSON path')
    parser.add_argument('--org', default=None)
    parser.add_argument('--project', default=None)
    parser.add_argument('--repo', default=None, help='Git repo name for PR queries')
    parser.add_argument('--states', '-s', help='Comma-separated states (default: NOT Closed/Removed)')
    parser.add_argument('--sprint-config', default=default_sprint_config,
                        help='Path to sprint-config.json (default: sprint-config.json next to script)')

    args = parser.parse_args()

    # --- Load sprint config ---
    sprint_cfg = load_sprint_config(args.sprint_config)

    # Resolve ADO settings: CLI flag > env var > sprint-config.ado > hardcoded defaults
    ado_cfg = (sprint_cfg or {}).get('ado', {})
    org = args.org or os.environ.get('ADO_ORG') or ado_cfg.get('org') or _DEFAULT_ADO['org']
    project = args.project or os.environ.get('ADO_PROJECT') or ado_cfg.get('project') or _DEFAULT_ADO['project']
    repo_name = args.repo or os.environ.get('ADO_REPO') or ado_cfg.get('repoName') or _DEFAULT_ADO['repoName']

    has_previous = sprint_cfg is not None and 'previous' in sprint_cfg
    has_current_iter = sprint_cfg is not None and sprint_cfg.get('current', {}).get('iterationPath')
    total_steps = (5 if has_previous else 4) + (1 if has_current_iter else 0)

    # Resolve area path: CLI flag > env var > sprint config areaPath > ado config > hardcoded default
    area_path = args.area or os.environ.get('ADO_AREA') or (sprint_cfg or {}).get('areaPath') or ado_cfg.get('areaPath') or _DEFAULT_ADO['areaPath']

    if sprint_cfg:
        current_name = sprint_cfg.get('current', {}).get('name', '?')
        print(f"  Sprint config loaded: current={current_name}, "
              f"previous={'yes' if has_previous else 'none'}, "
              f"areaPath from config={sprint_cfg.get('areaPath', 'n/a')}", file=sys.stderr)

    # --- Auth ---
    print(f"[0/{total_steps}] Authenticating...", file=sys.stderr)
    with timed("Auth"):
        token = get_ado_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    # --- Build roster from Graph (if rosterSeeds configured) ---
    roster_seeds = (sprint_cfg or {}).get("rosterSeeds")
    if roster_seeds:
        print(f"  Building roster from Microsoft Graph...", file=sys.stderr)
        with timed("Graph roster"):
            graph_token = get_graph_token()
            if graph_token:
                graph_headers = {"Authorization": f"Bearer {graph_token}", "Content-Type": "application/json"}
                dynamic_roster = build_roster_from_graph(roster_seeds, graph_headers)
                if dynamic_roster:
                    sprint_cfg["roster"] = dynamic_roster
                    # Write roster to separate file so sprint-config stays immutable
                    roster_path = os.path.join(os.path.dirname(__file__), "data", "computed-roster.json")
                    with open(roster_path, 'w') as f:
                        json.dump(dynamic_roster, f, indent=2)
                    print(f"  Dynamic roster: {len(dynamic_roster)} people → {roster_path}", file=sys.stderr)
                else:
                    print(f"  Graph roster empty, falling back to static roster.", file=sys.stderr)
            else:
                print(f"  Graph auth failed, falling back to static roster.", file=sys.stderr)

    # --- WIQL ---
    states = [s.strip() for s in args.states.split(',')] if args.states else None
    wiql = build_wiql(area_path, states)
    print(f"[1/{total_steps}] Querying work items...", file=sys.stderr)
    print(f"  WIQL: {wiql}", file=sys.stderr)

    with timed("WIQL query"):
        ids = fetch_work_item_ids_rest(wiql, org, project, headers)

    if not ids:
        print("No work items found.", file=sys.stderr)
        data = build_dashboard_data([], [], area_path)
        os.makedirs(os.path.dirname(args.output) or '.', exist_ok=True)
        with open(args.output, 'w') as f:
            json.dump(data, f, indent=2)
        print(f"Wrote empty dashboard to {args.output}", file=sys.stderr)
        return

    print(f"  Found {len(ids)} work item IDs.", file=sys.stderr)

    # --- Batch fetch work items ---
    print(f"[2/{total_steps}] Batch-fetching {len(ids)} work items (with relations)...", file=sys.stderr)
    with timed("Batch work items"):
        raw_items = fetch_work_items_batch(ids, org, project, headers)

    work_items = [extract_work_item(item) for item in raw_items]
    print(f"  Done: {len(work_items)} items extracted.", file=sys.stderr)

    # --- Current sprint closed/resolved items ---
    # The main query excludes Closed items, but we need them for the current sprint
    # so velocity and completion tracking are accurate.
    if has_current_iter:
        cur_iter = sprint_cfg['current']['iterationPath']
        cur_name = sprint_cfg['current'].get('name', '?')
        step = 3
        print(f"[{step}/{total_steps}] Querying current sprint closed items ({cur_name})...", file=sys.stderr)
        closed_wiql = build_wiql(area_path, states=['Closed', 'Resolved'], iteration_path=cur_iter)
        print(f"  WIQL: {closed_wiql}", file=sys.stderr)

        with timed("Current sprint closed query"):
            closed_ids = fetch_work_item_ids_rest(closed_wiql, org, project, headers)

        if closed_ids:
            # Exclude any IDs already in the main set (shouldn't happen, but be safe)
            existing_ids = {wi['id'] for wi in work_items}
            new_closed_ids = [cid for cid in closed_ids if cid not in existing_ids]
            print(f"  Found {len(closed_ids)} closed items ({len(new_closed_ids)} new).", file=sys.stderr)
            if new_closed_ids:
                with timed("Current sprint closed batch fetch"):
                    closed_raw = fetch_work_items_batch(new_closed_ids, org, project, headers)
                closed_items = [extract_work_item(item) for item in closed_raw]
                work_items.extend(closed_items)
                print(f"  Merged {len(closed_items)} closed items into dataset.", file=sys.stderr)
        else:
            print(f"  No closed items in current sprint.", file=sys.stderr)

    # --- Previous sprint velocity ---
    prev_sprint_data = None
    if has_previous:
        prev = sprint_cfg['previous']
        prev_iter = prev.get('iterationPath', '')
        prev_name = prev.get('name', '?')
        print(f"[{3 + (1 if has_current_iter else 0)}/{total_steps}] Querying previous sprint closed items ({prev_name})...", file=sys.stderr)
        prev_wiql = build_wiql(area_path, states=['Closed', 'Resolved'], iteration_path=prev_iter)
        print(f"  WIQL: {prev_wiql}", file=sys.stderr)

        with timed("Previous sprint query"):
            prev_ids = fetch_work_item_ids_rest(prev_wiql, org, project, headers)

        if prev_ids:
            print(f"  Found {len(prev_ids)} closed items in {prev_name}.", file=sys.stderr)
            with timed("Previous sprint batch fetch"):
                prev_raw = fetch_work_items_batch(prev_ids, org, project, headers)
            prev_items = [extract_work_item(item) for item in prev_raw]
            prev_sprint_data = build_previous_sprint_data(prev_items, prev_name)
            print(f"  {len(prev_items)} items across {len(prev_sprint_data['people'])} people.", file=sys.stderr)
        else:
            print(f"  No closed items found in {prev_name}.", file=sys.stderr)
            prev_sprint_data = build_previous_sprint_data([], prev_name)

    # --- PRs ---
    pr_step = (4 if has_previous else 3) + (1 if has_current_iter else 0)
    prs = []
    if args.include_prs:
        print(f"[{pr_step}/{total_steps}] Fetching PRs (repo={repo_name}, status={args.pr_status})...", file=sys.stderr)
        with timed("PR fetch"):
            raw_prs = fetch_prs_rest(org, project, repo_name, args.pr_status, headers)
        known_people = {wi['assigned'] for wi in work_items if wi['assigned']}
        for pr_raw in raw_prs:
            pr = extract_pr(pr_raw)
            if pr['createdBy'] in known_people:
                prs.append(pr)
        print(f"  {len(prs)} PRs from team members (out of {len(raw_prs)} total).", file=sys.stderr)
    else:
        print(f"[{pr_step}/{total_steps}] Skipping PRs (use --include-prs to fetch).", file=sys.stderr)

    # --- Build dashboard ---
    build_step = 5 if has_previous else 4
    print(f"[{build_step}/{total_steps}] Building dashboard data...", file=sys.stderr)
    with timed("Dashboard build"):
        data = build_dashboard_data(work_items, prs, area_path)

    if prev_sprint_data:
        data['previousSprint'] = prev_sprint_data

    os.makedirs(os.path.dirname(args.output) or '.', exist_ok=True)
    with open(args.output, 'w') as f:
        json.dump(data, f, indent=2)

    overall_elapsed = time.perf_counter() - overall_start
    print(f"\nDone. {data['meta']['itemCount']} items, {data['meta']['prCount']} PRs.", file=sys.stderr)
    if prev_sprint_data:
        prev_total = sum(len(p['workItems']) for p in prev_sprint_data['people'].values())
        prev_pts = sum(p['metrics']['totalPoints'] for p in prev_sprint_data['people'].values())
        print(f"Previous sprint ({prev_sprint_data['name']}): {prev_total} closed items, {prev_pts} points.", file=sys.stderr)
    print(f"Total time: {overall_elapsed:.1f}s", file=sys.stderr)
    print(f"Output: {args.output}", file=sys.stderr)

    # Print quick summary
    print(f"\n--- Summary ---", file=sys.stderr)
    for name, pdata in data['people'].items():
        m = pdata['metrics']
        print(f"  {name}: {m['activeItems']} items, {m['openPRs']} PRs, "
              f"avg {m['avgDaysInState']}d in state", file=sys.stderr)


if __name__ == '__main__':
    main()
