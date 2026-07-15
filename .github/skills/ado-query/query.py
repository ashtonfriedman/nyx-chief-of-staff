#!/usr/bin/env python3
"""
ADO Work Item Query Tool
Fetches work items via az boards WIQL query, then batch-retrieves full details.
Outputs clean structured data grouped by work item type.

Usage:
  python query.py --iteration "{your-project}\\{your-team}\\{half}\\Sprint\\Sprint-13"
  python query.py --iteration "..." --area "{your-area-path}"
  python query.py --iteration "..." --states "New,Active" --types "User Story,Bug"
  python query.py --iteration "..." --tags "TeamTag" --group-by type
  python query.py --iteration "..." --group-by parent --output json
  python query.py --iteration "..." --parent 10000001
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.parse
from collections import defaultdict

AZ_CMD = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
DEFAULT_ORG = os.environ.get("ADO_ORG", "https://dev.azure.com/{your-org}")
DEFAULT_PROJECT = os.environ.get("ADO_PROJECT", "{your-project}")
DEFAULT_AREA = os.environ.get("ADO_AREA", r"{your-area-path}")


def run_az(args):
    result = subprocess.run(
        [AZ_CMD] + args,
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f"az error: {result.stderr.strip()}", file=sys.stderr)
        return None
    raw = re.sub(r'[\x00-\x1f]', ' ', result.stdout)
    try:
        return json.loads(raw, strict=False)
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}", file=sys.stderr)
        return None


def build_wiql(args):
    conditions = []
    if args.iteration:
        conditions.append(
            f"[System.IterationPath] UNDER '{args.iteration}'"
        )
    if args.area:
        conditions.append(
            f"[System.AreaPath] UNDER '{args.area}'"
        )
    if args.states:
        states = [s.strip() for s in args.states.split(',')]
        if len(states) == 1 and states[0].startswith('!'):
            conditions.append(
                f"[System.State] <> '{states[0][1:]}'"
            )
        else:
            negated = [s[1:] for s in states if s.startswith('!')]
            included = [s for s in states if not s.startswith('!')]
            if included:
                state_list = "', '".join(included)
                conditions.append(
                    f"[System.State] IN ('{state_list}')"
                )
            for ns in negated:
                conditions.append(f"[System.State] <> '{ns}'")
    else:
        conditions.append(
            "[System.State] NOT IN ('Closed', 'Removed')"
        )
    if args.types:
        type_list = "', '".join(t.strip() for t in args.types.split(','))
        conditions.append(
            f"[System.WorkItemType] IN ('{type_list}')"
        )
    if args.tags:
        for tag in args.tags.split(','):
            conditions.append(
                f"[System.Tags] CONTAINS '{tag.strip()}'"
            )
    if args.parent:
        conditions.append(f"[System.Parent] = {args.parent}")
    if args.assigned:
        if args.assigned.lower() == 'unassigned':
            conditions.append("[System.AssignedTo] = ''")
        else:
            conditions.append(
                f"[System.AssignedTo] CONTAINS '{args.assigned}'"
            )

    where = " AND ".join(conditions)
    return (
        f"SELECT [System.Id] FROM WorkItems WHERE {where} "
        f"ORDER BY [System.WorkItemType], [Microsoft.VSTS.Common.Priority]"
    )


def fetch_ids(wiql, org, project):
    data = run_az([
        "boards", "query",
        "--wiql", wiql,
        "--org", org,
        "--project", project,
        "-o", "json"
    ])
    if not data:
        return []
    return [item['fields']['System.Id'] for item in data if 'fields' in item]


def get_ado_token():
    result = subprocess.run(
        [AZ_CMD, "account", "get-access-token",
         "--resource", "499b84ac-1321-427f-aa17-267ca6975798"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)['accessToken']
    except (json.JSONDecodeError, KeyError):
        return None


def fetch_items_batch(ids, org, project):
    """Batch-fetch work items via REST API (up to 200 per request)."""
    import urllib.request
    token = get_ado_token()
    if not token:
        print("Failed to get ADO token, falling back to CLI", file=sys.stderr)
        return fetch_items_cli(ids)

    items = []
    chunk_size = 200
    for start in range(0, len(ids), chunk_size):
        chunk = ids[start:start + chunk_size]
        id_str = ','.join(str(i) for i in chunk)
        url = (
            f"{org}/{urllib.parse.quote(project, safe='')}/"
            f"_apis/wit/workitems?ids={id_str}&api-version=7.0"
        )
        req = urllib.request.Request(
            url, headers={'Authorization': f'Bearer {token}'}
        )
        try:
            resp = urllib.request.urlopen(req)
            raw = resp.read().decode('utf-8-sig')
            data = json.loads(raw, strict=False)
            items.extend(data.get('value', []))
            print(
                f"  fetched {min(start + chunk_size, len(ids))}/{len(ids)}...",
                file=sys.stderr, flush=True
            )
        except Exception as e:
            print(f"REST batch failed: {e}", file=sys.stderr)
            print("Falling back to CLI for this chunk", file=sys.stderr)
            items.extend(fetch_items_cli(chunk))
    return items


def fetch_items_cli(ids):
    """Fallback: fetch items one at a time via az CLI."""
    items = []
    for i, wid in enumerate(ids):
        data = run_az([
            "boards", "work-item", "show",
            "--id", str(wid),
            "-o", "json"
        ])
        if data:
            items.append(data)
        if (i + 1) % 20 == 0:
            print(f"  fetched {i + 1}/{len(ids)}...", file=sys.stderr, flush=True)
    return items


def extract_fields(item):
    f = item.get('fields', {})
    assigned = ''
    a = f.get('System.AssignedTo')
    if a and isinstance(a, dict):
        assigned = a.get('displayName', '')
    return {
        'id': f.get('System.Id', '') or item.get('id', ''),
        'type': f.get('System.WorkItemType', ''),
        'state': f.get('System.State', ''),
        'priority': f.get('Microsoft.VSTS.Common.Priority', ''),
        'title': str(f.get('System.Title', '')).strip(),
        'tags': str(f.get('System.Tags', '') or ''),
        'assigned': assigned,
        'parent': f.get('System.Parent', ''),
        'iteration': f.get('System.IterationPath', ''),
        'effort': f.get('Microsoft.VSTS.Scheduling.Effort', None),
        'storyPoints': f.get('Microsoft.VSTS.Scheduling.StoryPoints', None),
    }


def output_table(items, group_by):
    records = [extract_fields(i) for i in items]

    if group_by == 'parent':
        groups = defaultdict(list)
        for r in records:
            groups[r['parent'] or 'No Parent'].append(r)
        for parent_id in sorted(groups, key=lambda x: str(x)):
            print(f"\n--- Parent: {parent_id} ({len(groups[parent_id])} items) ---")
            print_table(groups[parent_id])
    elif group_by == 'type':
        groups = defaultdict(list)
        for r in records:
            groups[r['type']].append(r)
        type_order = ['Epic', 'Feature', 'User Story', 'Bug', 'Task']
        for t in type_order:
            if t in groups:
                print(f"\n=== {t} ({len(groups[t])}) ===")
                print_table(groups[t])
        for t in sorted(groups):
            if t not in type_order:
                print(f"\n=== {t} ({len(groups[t])}) ===")
                print_table(groups[t])
    elif group_by == 'assigned':
        groups = defaultdict(list)
        for r in records:
            groups[r['assigned'] or 'Unassigned'].append(r)
        for name in sorted(groups):
            print(f"\n--- {name} ({len(groups[name])} items) ---")
            print_table(groups[name])
    else:
        print_table(records)

    print(f"\nTotal: {len(records)} items")


def print_table(records):
    for r in records:
        assigned = r['assigned'][:18] if r['assigned'] else ''
        tags = r['tags'][:35] if r['tags'] else ''
        title = r['title'][:60]
        # Show effort for Features, storyPoints for stories/bugs
        cost = ''
        if r['type'] == 'Feature' and r.get('effort'):
            cost = f"{r['effort']:g}FP"
        elif r.get('storyPoints'):
            cost = f"{r['storyPoints']:g}SP"
        line = (
            f"  {r['id']} | {r['type']:12} | {r['state']:8} | "
            f"P{r['priority']} | {cost:5} | {assigned:18} | {title}"
        )
        if tags:
            line += f"  [{tags}]"
        print(line)


def output_json(items):
    records = [extract_fields(i) for i in items]
    json.dump(records, sys.stdout, indent=2)
    print()


def output_ids(items):
    for item in items:
        f = item.get('fields', {})
        print(f.get('System.Id', ''))


def main():
    parser = argparse.ArgumentParser(description='ADO Work Item Query Tool')
    parser.add_argument('--iteration', '-i', help='Iteration path (UNDER match)')
    parser.add_argument('--area', '-a', default=DEFAULT_AREA, help='Area path (UNDER match)')
    parser.add_argument('--states', '-s', help='Comma-separated states. Prefix with ! to exclude (e.g. "!Closed,!Removed")')
    parser.add_argument('--types', '-t', help='Comma-separated work item types')
    parser.add_argument('--tags', help='Comma-separated tags (AND match)')
    parser.add_argument('--parent', '-p', help='Parent work item ID')
    parser.add_argument('--assigned', help='Assigned to (contains match, or "unassigned")')
    parser.add_argument('--group-by', '-g', choices=['type', 'parent', 'assigned', 'none'], default='type')
    parser.add_argument('--output', '-o', choices=['table', 'json', 'ids'], default='table')
    parser.add_argument('--org', default=DEFAULT_ORG)
    parser.add_argument('--project', default=DEFAULT_PROJECT)
    parser.add_argument('--wiql', help='Raw WIQL override (skips query builder)')

    args = parser.parse_args()

    if not args.iteration and not args.wiql and not args.parent:
        parser.error("At least --iteration, --parent, or --wiql is required")

    wiql = args.wiql or build_wiql(args)
    print(f"Query: {wiql}\n", file=sys.stderr)

    ids = fetch_ids(wiql, args.org, args.project)
    if not ids:
        print("No items found.")
        return

    print(f"Found {len(ids)} items, fetching details...", file=sys.stderr, flush=True)
    items = fetch_items_batch(ids, args.org, args.project)

    if args.output == 'json':
        output_json(items)
    elif args.output == 'ids':
        output_ids(items)
    else:
        output_table(items, args.group_by)


if __name__ == '__main__':
    main()
