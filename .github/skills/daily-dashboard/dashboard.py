"""
Daily dashboard data gatherer: parallel collection from ADO, Graph, M365 query tool, and
local filesystem.  Writes dashboard-data.json consumed by the HTML renderer.

Stdlib only — no pip dependencies.  Requires az CLI + m365-query on PATH.
"""
import argparse, shutil, subprocess, json, ssl, sys, os, re, textwrap, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── Constants ────────────────────────────────────────────────────────────────

AZ = shutil.which('az') or r'C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd'

ADO_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798'
GRAPH_RESOURCE = 'https://graph.microsoft.com'

CHATS = {
    'Team Chat 1': '19:{thread-id-1}@thread.v2',
    'Team Chat 2': '19:{thread-id-2}@thread.v2',
    'Team Chat 3': '19:{thread-id-3}@thread.v2',
}

CHAT_LINKS = {
    'Team Chat 1':
        'msteams://teams.microsoft.com/l/message/19:{thread-id-1}@thread.v2',
    'Team Chat 2':
        'msteams://teams.microsoft.com/l/message/19:{thread-id-2}@thread.v2',
    'Team Chat 3':
        'msteams://teams.microsoft.com/l/message/19:{thread-id-3}@thread.v2',
}

VIPS = ['VIP One', 'VIP Two', 'VIP Three', 'VIP Four',
        'VIP Five', 'VIP Six', 'VIP Seven']

BATCH_LIMIT = 200
M365_TIMEOUT = 120

# Eastern Time offsets
ET_STD = timezone(timedelta(hours=-5))   # EST
ET_DST = timezone(timedelta(hours=-4))   # EDT


# ── Helpers ──────────────────────────────────────────────────────────────────

def log(msg):
    print(msg, file=sys.stderr, flush=True)


def eastern_now():
    """Return current datetime in US Eastern (handles DST heuristically)."""
    utcnow = datetime.now(timezone.utc)
    # US DST: second Sunday of March → first Sunday of November
    year = utcnow.year
    mar1 = datetime(year, 3, 1, tzinfo=timezone.utc)
    dst_start = mar1 + timedelta(days=(6 - mar1.weekday()) % 7 + 7)  # 2nd Sunday
    dst_start = dst_start.replace(hour=7)  # 2 AM ET = 7 AM UTC
    nov1 = datetime(year, 11, 1, tzinfo=timezone.utc)
    dst_end = nov1 + timedelta(days=(6 - nov1.weekday()) % 7)        # 1st Sunday
    dst_end = dst_end.replace(hour=6)  # 2 AM ET (EDT) = 6 AM UTC
    if dst_start <= utcnow < dst_end:
        return utcnow.astimezone(ET_DST)
    return utcnow.astimezone(ET_STD)


def fmt_time_12h(dt):
    """Format a datetime as '10:05 AM'."""
    return dt.strftime('%I:%M %p').lstrip('0')


def utc_iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%SZ')


def iso_now():
    return datetime.now(timezone.utc).isoformat()


# ── Token acquisition ────────────────────────────────────────────────────────

def get_token(resource):
    r = subprocess.run([AZ, 'account', 'get-access-token',
                        '--resource', resource, '-o', 'json'],
                       capture_output=True, text=True, shell=True)
    if r.returncode != 0:
        log(f'ERROR: az login may be needed: {r.stderr}')
        sys.exit(1)
    return json.loads(r.stdout)['accessToken']


# ── HTTP helpers ─────────────────────────────────────────────────────────────

def ado_post(url, body, token):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method='POST',
                                headers={'Authorization': f'Bearer {token}',
                                         'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def ado_get(url, token):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def graph_get(url, token):
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def m365_query(question):
    """Run m365-query ask -q '...' and return stdout text."""
    try:
        r = subprocess.run(['m365-query', 'ask', '-q', question],
                           capture_output=True, text=True, timeout=M365_TIMEOUT,
                           shell=True)  # shell=True needed on Windows for .cmd wrappers
        if r.returncode != 0:
            return f'ERROR: {r.stderr[:200]}'
        return r.stdout.strip()
    except FileNotFoundError:
        return 'ERROR: m365-query not found on PATH'
    except subprocess.TimeoutExpired:
        return 'ERROR: m365-query timed out'


# ── WIQL execution helper ───────────────────────────────────────────────────

def wiql_query(wiql, base_url, token):
    """Run a WIQL query and batch-fetch the resulting work item details."""
    resp = ado_post(f'{base_url}/wiql?api-version=7.0', {'query': wiql}, token)
    ids = [item['id'] for item in resp.get('workItems', [])]
    if not ids:
        return []

    # Determine which fields the WIQL selected so we can request them
    field_match = re.search(r'SELECT\s+(.*?)\s+FROM', wiql, re.IGNORECASE | re.DOTALL)
    if field_match:
        raw_fields = field_match.group(1)
        fields = [f.strip().strip('[]') for f in raw_fields.split(',')]
        field_param = ','.join(fields)
    else:
        field_param = None

    items = []
    for i in range(0, len(ids), BATCH_LIMIT):
        chunk = ids[i:i + BATCH_LIMIT]
        id_str = ','.join(str(x) for x in chunk)
        url = f'{base_url}/workitems?ids={id_str}&api-version=7.0'
        if field_param:
            url += f'&fields={urllib.parse.quote(field_param)}'
        resp = ado_get(url, token)
        items.extend(resp.get('value', []))
    return items


# ── ADO data gathering ───────────────────────────────────────────────────────

def gather_ado(args, token):
    """Fetch ADO work items: active, completed, state changes."""
    log('  ADO: querying active items...')
    org_enc = args.org
    proj_enc = urllib.parse.quote(args.project)
    base = f'{org_enc}/{proj_enc}/_apis/wit'
    area = args.area
    now_et = eastern_now()
    today_str = now_et.strftime('%Y-%m-%d')

    # --- WIQL 1: Active items assigned to me ---
    wiql_active = (
        "SELECT [System.Id],[System.Title],[System.State],[System.WorkItemType],"
        "[System.CreatedDate],[Microsoft.VSTS.Common.Priority],[System.IterationPath],"
        "[System.Parent]"
        " FROM WorkItems"
        " WHERE [System.AssignedTo] = @Me"
        " AND [System.State] NOT IN ('Closed','Removed','Done')"
        f" AND [System.AreaPath] UNDER '{area}'"
        " ORDER BY [Microsoft.VSTS.Common.Priority] ASC"
    )

    # --- WIQL 2: Recently completed (last 30 days) ---
    wiql_completed = (
        "SELECT [System.Id],[System.Title],[System.State],[System.WorkItemType],"
        "[Microsoft.VSTS.Common.ClosedDate],[System.Parent]"
        " FROM WorkItems"
        " WHERE [System.AssignedTo] = @Me"
        " AND [System.State] IN ('Closed','Done')"
        " AND [Microsoft.VSTS.Common.ClosedDate] >= @Today - 30"
        f" AND [System.AreaPath] UNDER '{area}'"
    )

    # --- WIQL 3: State changes (last 24h) ---
    wiql_changes = (
        "SELECT [System.Id],[System.Title],[System.State],"
        "[System.ChangedDate],[System.ChangedBy]"
        " FROM WorkItems"
        f" WHERE [System.AreaPath] UNDER '{area}'"
        " AND [System.ChangedDate] >= @Today - 1"
        " ORDER BY [System.ChangedDate] DESC"
    )

    # Execute all three queries (sequentially to stay within API limits)
    active_items = wiql_query(wiql_active, base, token)
    log(f'  ADO: {len(active_items)} active items')

    completed_items = wiql_query(wiql_completed, base, token)
    log(f'  ADO: {len(completed_items)} recently completed')

    changed_items = wiql_query(wiql_changes, base, token)
    log(f'  ADO: {len(changed_items)} state changes (24h)')

    # Determine period prefix for bucketing
    period_prefix = args.period  # may be None
    if period_prefix is None and active_items:
        # Auto-detect: find most common second path segment across active items
        from collections import Counter
        seg_counts = Counter()
        for item in active_items:
            ip = item.get('fields', {}).get('System.IterationPath', '')
            parts = ip.split('\\')
            if len(parts) >= 2:
                seg = parts[1].strip()
                if seg.lower() != 'backlog':
                    seg_counts[seg] += 1
        if seg_counts:
            period_prefix = seg_counts.most_common(1)[0][0]
            log(f'  ADO: auto-detected period prefix: {period_prefix}')

    # --- Process active items ---
    current_period = []
    future_ado = []
    aging_items = []

    for item in active_items:
        f = item.get('fields', {})
        item_id = item.get('id')
        title = f.get('System.Title', '')
        state = f.get('System.State', '')
        wtype = f.get('System.WorkItemType', '')
        created_raw = f.get('System.CreatedDate', '')
        priority = f.get('Microsoft.VSTS.Common.Priority', 0)
        iteration = f.get('System.IterationPath', '')
        parent_id = f.get('System.Parent')

        created_date = created_raw[:10] if created_raw else ''

        # Calculate iteration short name (last path segment)
        iter_short = iteration.rsplit('\\', 1)[-1] if iteration else ''

        entry = {
            'id': item_id,
            'type': wtype,
            'title': title,
            'state': state,
            'created': created_date,
            'parentId': parent_id,
            'iteration': iteration,
            'iterationShort': iter_short,
        }

        # Bucket into current period vs future/backlog
        is_current = False
        if period_prefix and period_prefix.lower() in iteration.lower():
            is_current = True
        elif 'backlog' in iteration.lower():
            future_ado.append({**entry, 'ageDays': _age_days(created_date, today_str)})
            continue

        if is_current:
            current_period.append(entry)
        else:
            # Items not in backlog and not in current period → future
            future_ado.append({**entry, 'ageDays': _age_days(created_date, today_str)})

        # Aging check: >14 days and still open
        age = _age_days(created_date, today_str)
        if age > 14:
            aging_items.append({
                'id': item_id,
                'title': title,
                'created': created_date,
                'ageDays': age,
                'state': state,
                'priority': priority,
            })

    # --- Process completed items ---
    recently_completed = []
    for item in completed_items:
        f = item.get('fields', {})
        recently_completed.append({
            'id': item.get('id'),
            'title': f.get('System.Title', ''),
            'parentNote': None,
        })

    # --- Process state changes ---
    state_changes = []
    for item in changed_items:
        f = item.get('fields', {})
        state_changes.append({
            'id': item.get('id'),
            'title': f.get('System.Title', ''),
            'fromState': None,  # skip revision fetch to avoid N+1
            'toState': f.get('System.State', ''),
        })

    # Determine label for current period
    if period_prefix:
        label = f'Current Period ({period_prefix})'
    elif current_period:
        label = current_period[0].get('iterationShort', 'This Period')
    else:
        label = 'This Period'

    return {
        'currentPeriod': {'label': label, 'items': current_period},
        'futureAdo': future_ado,
        'adoCleanup': [],
        'agingItems': aging_items,
        'recentlyCompleted': recently_completed,
        'stateChanges': state_changes,
    }


def _age_days(created_str, today_str):
    """Calculate days between two YYYY-MM-DD strings."""
    try:
        c = datetime.strptime(created_str[:10], '%Y-%m-%d')
        t = datetime.strptime(today_str[:10], '%Y-%m-%d')
        return (t - c).days
    except (ValueError, TypeError):
        return 0


# ── Calendar data gathering ──────────────────────────────────────────────────

def gather_calendar(graph_token):
    """Fetch today's and yesterday's calendar events via Graph API."""
    log('  Calendar: fetching events...')
    now_et = eastern_now()
    today_start = now_et.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    yesterday_start = today_start - timedelta(days=1)

    base = 'https://graph.microsoft.com/v1.0/me/calendarView'
    select_today = ('subject,start,end,attendees,responseStatus,showAs,'
                    'isOnlineMeeting')
    select_yesterday = 'subject,start,end'

    today_url = (f'{base}?startDateTime={utc_iso(today_start)}'
                 f'&endDateTime={utc_iso(today_end)}'
                 f'&$select={select_today}'
                 f'&$orderby=start/dateTime&$top=50')

    yesterday_url = (f'{base}?startDateTime={utc_iso(yesterday_start)}'
                     f'&endDateTime={utc_iso(today_start)}'
                     f'&$select={select_yesterday}'
                     f'&$orderby=start/dateTime&$top=50')

    today_events = graph_get(today_url, graph_token).get('value', [])
    yesterday_events = graph_get(yesterday_url, graph_token).get('value', [])

    log(f'  Calendar: {len(today_events)} today, {len(yesterday_events)} yesterday')

    today_meetings = []
    for ev in today_events:
        start_dt = _parse_graph_time(ev.get('start', {}))
        end_dt = _parse_graph_time(ev.get('end', {}))
        if not start_dt:
            continue

        attendee_names = _extract_attendees(ev.get('attendees', []))
        show_as = (ev.get('showAs') or '').lower()
        resp_status = (ev.get('responseStatus', {}).get('response') or '').lower()

        dimmed = show_as in ('free', 'tentative') or resp_status in ('none', 'declined')
        important = any(vip.lower() in ' '.join(attendee_names).lower() for vip in VIPS)

        time_str = fmt_time_12h(start_dt)
        if end_dt:
            time_str += f' - {fmt_time_12h(end_dt)}'

        today_meetings.append({
            'time': time_str,
            'title': ev.get('subject', ''),
            'attendees': ', '.join(attendee_names),
            'notes': '',
            'dimmed': dimmed,
            'important': important,
        })

    yesterday_recaps = []
    for ev in yesterday_events:
        yesterday_recaps.append({
            'meeting': ev.get('subject', ''),
            'text': '',
        })

    return {
        'todayMeetings': today_meetings,
        'yesterdayRecaps': yesterday_recaps,
        'oneOnOnePrep': [],
    }


def _parse_graph_time(time_obj):
    """Parse Graph API time object to ET datetime."""
    raw = time_obj.get('dateTime', '')
    if not raw:
        return None
    tz_name = time_obj.get('timeZone', 'UTC')
    try:
        dt = datetime.fromisoformat(raw.rstrip('Z'))
        if tz_name == 'UTC' or raw.endswith('Z'):
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            # Graph often returns in the user's timezone already
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(eastern_now().tzinfo)
    except (ValueError, TypeError):
        return None


def _extract_attendees(attendees):
    """Pull display names from Graph attendees list, excluding the organizer."""
    names = []
    for att in attendees:
        email_addr = att.get('emailAddress', {})
        name = email_addr.get('name', email_addr.get('address', ''))
        if name:
            names.append(name)
    return names


# ── M365 query tool (M365) data gathering ────────────────────────────────────────────

def gather_m365(work_items_context):
    """Run M365 query tool semantic queries for Teams, email, and meeting recaps."""
    log('  M365: launching M365 query tool queries...')
    now_et = eastern_now()
    is_monday = now_et.weekday() == 0
    lookback = 'since last Friday' if is_monday else f'since {(now_et - timedelta(days=1)).strftime("%A %B %d")}'
    yesterday = (now_et - timedelta(days=1)).strftime('%A %B %d, %Y')
    today_str = now_et.strftime('%Y-%m-%d')
    ctx = work_items_context or 'no items loaded'

    queries = {}

    # 1-3: Chat rollups
    for chat_name, thread_id in CHATS.items():
        queries[f'chat:{chat_name}'] = (
            f'Summarize messages sent {lookback} in the Teams chat thread {thread_id} '
            f"(this is the '{chat_name}' group chat). "
            f'For context, my current work items are: {ctx}. '
            'Organize by: 1) Any mentions of me or my work items, '
            '2) Open questions needing input, 3) Decisions made, '
            '4) Action items assigned, 5) Announcements or knowledge sharing. '
            'Be concise. Bullet points only. No follow-up offers.'
        )

    # 4: Direct mentions
    queries['mentions'] = (
        f'Find any Teams messages sent {lookback} where I was directly mentioned '
        'or tagged, across all chats and channels. List each with the chat name, '
        f'who mentioned me, and what they said. Note if any relate to these work items: {ctx}. '
        'Be concise. Bullet points only. No follow-up offers.'
    )

    # 5: Yesterday recaps
    queries['recaps'] = (
        f'Summarize decisions and action items from meetings I attended yesterday, {yesterday}. '
        f'Use transcripts if available. Note if any relate to these work items: {ctx}. '
        'Be concise. Bullet points only. No follow-up offers.'
    )

    # 6: Urgent/VIP emails
    vip_str = ', '.join(VIPS)
    queries['emails:urgent'] = (
        'Find emails from the last 24 hours that are either marked high importance '
        f'or are from: {vip_str}. Summarize each briefly and flag any that need my reply. '
        'Be concise. Bullet points only. No follow-up offers.'
    )

    # 7: Awaiting reply
    queries['emails:awaiting'] = (
        'Find email threads from the last 48 hours where someone asked me a direct '
        'question or is waiting for my response. List sender, subject, and what '
        "they're waiting on. Be concise. Bullet points only. No follow-up offers."
    )

    # Execute all queries in parallel
    results = {}
    with ThreadPoolExecutor(max_workers=7) as pool:
        futures = {pool.submit(m365_query, q): key for key, q in queries.items()}
        for future in as_completed(futures):
            key = futures[future]
            try:
                results[key] = future.result()
                log(f'  M365: completed {key}')
            except Exception as e:
                results[key] = f'ERROR: {e}'
                log(f'  M365: FAILED {key}: {e}')

    # Parse chat rollups into structured sections
    mentions = []
    open_questions = []
    decisions = []
    action_items = []
    knowledge_drops = []

    for chat_name in CHATS:
        key = f'chat:{chat_name}'
        raw = results.get(key, '')
        if raw.startswith('ERROR:'):
            knowledge_drops.append({'title': chat_name, 'text': raw})
            continue
        parsed = _parse_chat_rollup(raw, chat_name, today_str)
        mentions.extend(parsed['mentions'])
        open_questions.extend(parsed['openQuestions'])
        decisions.extend(parsed['decisions'])
        action_items.extend(parsed['actionItems'])
        knowledge_drops.extend(parsed['knowledgeDrops'])

    # Parse direct mentions — M365 query tool returns structured blocks per mention
    mentions_raw = results.get('mentions', '')
    if mentions_raw and not mentions_raw.startswith('ERROR:'):
        clean = _strip_citations(mentions_raw)
        # Parse structured mention blocks: detect "Mentioned by:" and "Message:" fields
        current_chat = 'Cross-chat scan'
        current_who = 'Unknown'
        current_msg_parts = []

        def _flush_mention():
            if current_msg_parts:
                text = ' '.join(current_msg_parts).strip()
                if text and not _is_garbage(text):
                    mentions.append({
                        'from': current_who,
                        'source': current_chat,
                        'text': text,
                        'timestamp': today_str,
                        'link': None,
                    })

        for line in clean.splitlines():
            stripped = line.strip().lstrip('-•*').strip()
            if not stripped:
                continue
            # Skip numbered section headers and garbage
            if re.match(r'^\d+\)\s', stripped) or _is_garbage(stripped):
                continue
            # Detect chat name: **Chat: Name** or **Chat name**
            chat_match = re.match(r'^\*\*Chat:\s*(.+?)\*\*', stripped)
            if chat_match:
                _flush_mention()
                current_chat = chat_match.group(1).strip() or 'Cross-chat scan'
                current_who = 'Unknown'
                current_msg_parts = []
                continue
            # Detect "Mentioned by:" field
            by_match = re.match(r'^\*\*Mentioned by:\*\*\s*(.+)', stripped)
            if by_match:
                _flush_mention()
                current_who = by_match.group(1).strip()
                current_msg_parts = []
                continue
            # Detect "Message:" field — start of the actual mention content
            msg_match = re.match(r'^\*\*Message:\*\*\s*(.+)', stripped)
            if msg_match:
                current_msg_parts = [msg_match.group(1).strip().strip('"')]
                continue
            # Skip structural fields like "Work item related: No"
            if re.match(r'^\*\*Work item', stripped):
                continue
            # If we're inside a message, accumulate. Otherwise try name extraction.
            if current_msg_parts:
                current_msg_parts.append(stripped.strip('"'))
            else:
                # Fallback: line starts with a person name
                who_match = re.match(r'^(?:\*\*)?([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)(?:\*\*)?\s', stripped)
                if who_match:
                    _flush_mention()
                    current_who = who_match.group(1)
                    rest = stripped[who_match.end():].strip().lstrip('–—-:').strip()
                    current_msg_parts = [rest] if rest else []
                else:
                    # Standalone content line — treat as a mention from unknown
                    _flush_mention()
                    current_who = 'Unknown'
                    current_msg_parts = [stripped]
        _flush_mention()

    # Urgent emails
    urgent_raw = results.get('emails:urgent', '')
    urgent_emails = []
    if urgent_raw and not urgent_raw.startswith('ERROR:'):
        for line in _bullet_lines(urgent_raw):
            urgent_emails.append({
                'from': 'M365 query tool scan',
                'subject': line,
                'needsReply': 'reply' in line.lower() or 'respond' in line.lower(),
            })

    # Awaiting reply
    awaiting_raw = results.get('emails:awaiting', '')
    awaiting_reply = []
    if awaiting_raw and not awaiting_raw.startswith('ERROR:'):
        for line in _bullet_lines(awaiting_raw):
            awaiting_reply.append({
                'from': 'M365 query tool scan',
                'subject': line,
                'waitingOn': '',
            })

    # Yesterday recaps from M365 query tool — group by meeting, filter structural headers
    recaps_raw = results.get('recaps', '')
    yesterday_recaps = []
    if recaps_raw and not recaps_raw.startswith('ERROR:'):
        clean = _strip_citations(recaps_raw)
        current_meeting = None
        _RECAP_SKIP = re.compile(
            r'(?i)^(\*\*)?'
            r'(Decisions?|Action Items?|Key (Decisions|Takeaways|Points)|'
            r'Summary|Notes?|Agenda|Highlights?|Updates?|Discussion)'
            r'(\*\*)?:?\s*$'
        )
        _RECAP_META = re.compile(
            r'(?i)^(I found \*?\*?\d+ meeting|Both had recordings|Below are|'
            r'using transcripts|where available|---+)',
        )
        for line in clean.splitlines():
            stripped = line.strip().lstrip('-•*').strip()
            if not stripped:
                continue
            # Skip meta-commentary
            if _RECAP_META.match(stripped):
                continue
            # Detect meeting header: **Meeting Name (time, ...)** or **Meeting Name (transcript available)**
            meeting_match = re.match(
                r'^\*\*(.+?)\s*\(.*?(?:\d{1,2}:\d{2}|transcript|no transcript).*?\)\*\*', stripped
            )
            if meeting_match:
                current_meeting = meeting_match.group(1).strip()
                continue
            # Also catch bold-only meeting names without parens: **Name / Title**
            bold_match = re.match(r'^\*\*(.+?)\*\*$', stripped)
            if bold_match:
                text = bold_match.group(1).strip()
                # If it's a structural label, skip it
                if _RECAP_SKIP.match(f'**{text}**'):
                    continue
                # If it looks like a meeting name (long enough, not a keyword)
                if len(text) > 10:
                    current_meeting = text
                    continue
            # Skip structural headers without bold
            if _RECAP_SKIP.match(stripped):
                continue
            # Clean content
            content = _strip_citations(stripped)
            if not content or _is_garbage(content):
                continue
            yesterday_recaps.append({
                'meeting': current_meeting or 'Meeting recap',
                'text': content,
            })

    return {
        'mentions': mentions,
        'openQuestions': open_questions,
        'decisions': decisions,
        'actionItems': action_items,
        'knowledgeDrops': knowledge_drops,
        'urgentEmails': urgent_emails,
        'awaitingReply': awaiting_reply,
        'yesterdayRecaps': yesterday_recaps,
    }


def _strip_citations(text):
    """Remove markdown citation links [N](url) and bare [N] references."""
    text = re.sub(r'\[(\d+)\]\([^)]*\)', '', text)   # [1](https://...)
    text = re.sub(r'\[(\d+)\]', '', text)              # bare [1]
    return text.strip()


_GARBAGE_PATTERNS = re.compile(
    r'(?i)^(\*\*)?'
    r'(none found|no (direct )?mentions|no action items|no decisions|'
    r'no open questions|nothing found|no results|what i \*?can\*? do|'
    r'no specific|no explicit|not specifically|I couldn.t find|'
    r'no messages found|no new messages|no activity|no updates|'
    r'let me know if|would you like|I can also|here.s what)',
)

# Standalone section labels that are structure, not content
_SECTION_LABELS = re.compile(
    r'(?i)^[\s*]*'
    r'(action items?|decisions?|open questions?|announcements?|'
    r'mentions?|knowledge sharing|summary|highlights?|updates?|notes?)'
    r'[\s*:]*$'
)


def _is_garbage(line):
    """True if a line is meta-commentary, empty result, M365 query tool filler, or standalone section label."""
    clean = _strip_citations(line)
    if len(clean) < 10:
        return True
    if _GARBAGE_PATTERNS.match(clean):
        return True
    if _SECTION_LABELS.match(clean):
        return True
    return False


def _bullet_lines(text):
    """Extract non-empty bullet/content lines from M365 query tool output, skipping headers and garbage."""
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        # Skip markdown headers, numbered section headers, and citation-only lines
        if re.match(r'^#{1,4}\s', stripped):
            continue
        if re.match(r'^\d+\)\s', stripped):
            continue
        if re.match(r'^\*\*\(\d+ total', stripped, re.IGNORECASE):
            continue
        stripped = stripped.lstrip('-•*').strip()
        if not stripped:
            continue
        stripped = _strip_citations(stripped)
        if stripped and not _is_garbage(stripped):
            lines.append(stripped)
    return lines


def _parse_chat_rollup(raw, chat_name, today_str):
    """Heuristic parse of M365 query tool chat summary into structured buckets.
    
    M365 query tool returns numbered sections (1-5) per our prompt. We detect section
    headers and route items accordingly. Fallback: keyword heuristics on
    citation-stripped text.
    """
    result = {
        'mentions': [],
        'openQuestions': [],
        'decisions': [],
        'actionItems': [],
        'knowledgeDrops': [],
    }
    link = CHAT_LINKS.get(chat_name)

    # Try to detect sections by numbered headers in the raw text
    current_section = None
    section_map = {
        'mention': 'mentions',
        'open question': 'openQuestions',
        'question': 'openQuestions',
        'decision': 'decisions',
        'action item': 'actionItems',
        'action': 'actionItems',
        'announcement': 'knowledgeDrops',
        'knowledge': 'knowledgeDrops',
    }

    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        # Detect section headers: "1) Mentions of me" / "**1. Mentions**" / "### 2) Open questions"
        # Must start with a number or markdown header — not plain content
        header_match = re.match(
            r'^(?:#{1,4}\s+)?(?:\*\*)?(\d+[).]\s*.+?)(?:\*\*)?$', stripped
        )
        if header_match:
            header_text = header_match.group(1).strip().lower()
            matched_section = False
            for keyword, section_key in section_map.items():
                if keyword in header_text:
                    current_section = section_key
                    matched_section = True
                    break
            if matched_section:
                continue  # Don't process the header line as content

        # Clean the line for content extraction
        clean = stripped.lstrip('-•*').strip()
        clean = _strip_citations(clean)
        if not clean or _is_garbage(clean):
            continue

        # Route by current section if detected, else keyword fallback
        if current_section == 'mentions':
            result['mentions'].append({
                'from': chat_name, 'source': chat_name,
                'text': clean, 'timestamp': today_str, 'link': link,
            })
        elif current_section == 'openQuestions':
            result['openQuestions'].append({
                'topic': chat_name, 'text': clean, 'relatedItem': None,
            })
        elif current_section == 'decisions':
            result['decisions'].append({
                'topic': chat_name, 'text': clean, 'who': 'Team',
                'source': chat_name, 'sourceLink': link,
                'style': 'agreement', 'link': None,
            })
        elif current_section == 'actionItems':
            result['actionItems'].append({
                'assignee': '', 'text': clean, 'source': chat_name,
                'sourceLink': link, 'requestedBy': None,
                'deadline': None, 'link': None,
            })
        elif current_section == 'knowledgeDrops':
            result['knowledgeDrops'].append({
                'title': chat_name, 'text': clean,
            })
        else:
            # No section detected — keyword fallback on CLEAN text (no URLs)
            lower = clean.lower()
            if any(kw in lower for kw in ['@me', 'tagged me', 'mentioned me', 'pinged me']):
                result['mentions'].append({
                    'from': chat_name, 'source': chat_name,
                    'text': clean, 'timestamp': today_str, 'link': link,
                })
            elif '?' in clean and any(kw in lower for kw in ['need input', 'waiting for',
                                                               'needs clarification', 'who ',
                                                               'when ', 'should we', 'can we']):
                result['openQuestions'].append({
                    'topic': chat_name, 'text': clean, 'relatedItem': None,
                })
            elif any(kw in lower for kw in ['decided', 'agreed', 'consensus',
                                              'approved', 'confirmed']):
                result['decisions'].append({
                    'topic': chat_name, 'text': clean, 'who': 'Team',
                    'source': chat_name, 'sourceLink': link,
                    'style': 'agreement', 'link': None,
                })
            elif any(kw in lower for kw in ['action item', 'todo', 'follow up',
                                              'follow-up', 'will do', 'needs to']):
                result['actionItems'].append({
                    'assignee': '', 'text': clean, 'source': chat_name,
                    'sourceLink': link, 'requestedBy': None,
                    'deadline': None, 'link': None,
                })
            else:
                result['knowledgeDrops'].append({
                    'title': chat_name, 'text': clean,
                })

    return result


# ── Mind / local filesystem gathering ────────────────────────────────────────

def gather_mind(mind_root):
    """Read initiatives, next-actions, and inbox notes from the local mind repo."""
    log('  Mind: scanning local files...')
    root = Path(mind_root)
    initiatives_dir = root / 'initiatives'
    inbox_dir = root / 'inbox'

    active_initiatives = []
    next_actions = []
    inbox_notes = []

    # Initiatives
    if initiatives_dir.is_dir():
        for child in sorted(initiatives_dir.iterdir()):
            if not child.is_dir():
                continue
            active_initiatives.append({'name': child.name})
            na_file = child / 'next-actions.md'
            if na_file.is_file():
                items = _extract_open_tasks(na_file)
                if items:
                    next_actions.append({'source': child.name, 'items': items})

    # Inbox next-actions
    inbox_na = inbox_dir / 'next-actions.md'
    if inbox_na.is_file():
        items = _extract_open_tasks(inbox_na)
        if items:
            next_actions.append({'source': 'inbox', 'items': items})

    # Inbox notes (markdown files)
    if inbox_dir.is_dir():
        skip = {'next-actions.md', 'read-this.md', '.gitkeep'}
        for f in sorted(inbox_dir.iterdir()):
            if not f.is_file() or f.name.lower() in skip:
                continue
            if f.suffix == '.md':
                try:
                    text = f.read_text(encoding='utf-8', errors='replace')
                    # Summarize: first 500 chars
                    summary = text[:500].strip()
                    if summary:
                        inbox_notes.append({'text': f'{f.name}: {summary}'})
                except Exception:
                    pass

    log(f'  Mind: {len(active_initiatives)} initiatives, '
        f'{sum(len(a["items"]) for a in next_actions)} next-actions, '
        f'{len(inbox_notes)} inbox notes')

    return {
        'activeInitiatives': active_initiatives,
        'nextActions': next_actions,
        'inboxNotes': inbox_notes,
    }


def _extract_open_tasks(filepath):
    """Extract unchecked task lines (- [ ]) from a markdown file."""
    items = []
    try:
        text = filepath.read_text(encoding='utf-8', errors='replace')
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith('- [ ]'):
                items.append(stripped[5:].strip())
    except Exception:
        pass
    return items


# ── Focus recommendations ────────────────────────────────────────────────────

def compute_focus_recs(ado_data, calendar_data, email_data):
    """Heuristic-based focus recommendations, ranked by urgency."""
    recs = []
    now_et = eastern_now()

    # 1. Meetings in next 2 hours needing prep
    for mtg in calendar_data.get('todayMeetings', []):
        if mtg.get('dimmed'):
            continue
        try:
            time_part = mtg['time'].split(' - ')[0].strip()
            mtg_time = datetime.strptime(
                f'{now_et.strftime("%Y-%m-%d")} {time_part}',
                '%Y-%m-%d %I:%M %p'
            ).replace(tzinfo=now_et.tzinfo)
            delta = (mtg_time - now_et).total_seconds() / 60
            if 0 < delta <= 120:
                recs.append((1, f"Prep for '{mtg['title']}' at {time_part} "
                            f"({int(delta)} min). {mtg.get('attendees', '')}"))
        except (ValueError, KeyError):
            pass

    # 2. High-priority aging items
    for item in sorted(ado_data.get('agingItems', []),
                       key=lambda x: (-x.get('priority', 99), -x.get('ageDays', 0))):
        if item.get('priority', 99) <= 2:
            recs.append((2, f"Aging P{item['priority']} #{item['id']}: {item['title']} "
                        f"({item.get('ageDays', '?')} days)"))

    # 3. VIP emails needing reply
    for em in email_data.get('urgentEmails', []):
        if em.get('needsReply'):
            recs.append((3, f"Reply needed: {em['subject']}"))

    # 4. State changes needing attention
    for sc in ado_data.get('stateChanges', [])[:3]:
        recs.append((4, f"State change: #{sc['id']} {sc['title']} → {sc['toState']}"))

    # Rank and return top 3
    recs.sort(key=lambda x: x[0])
    return [{'rank': i + 1, 'text': text} for i, (_, text) in enumerate(recs[:3])]


# ── Build work-items context string ──────────────────────────────────────────

def build_work_items_context(ado_data):
    """Build a concise context string from ADO active items for M365 query tool queries."""
    items = ado_data.get('currentPeriod', {}).get('items', [])
    parts = []
    for item in items[:15]:
        parts.append(f"#{item['id']} {item['title']}")
    return ', '.join(parts) if parts else ''


# ── Assembly ─────────────────────────────────────────────────────────────────

def load_existing(path):
    """Load existing dashboard JSON if present."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def write_atomic(data, path):
    """Write JSON atomically via temp file + rename."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    # On Windows, rename fails if target exists — remove first
    if path.exists():
        path.unlink()
    tmp.rename(path)
    log(f'Wrote {path} ({path.stat().st_size:,} bytes)')


def merge_dashboard(existing, sections, ado_data, calendar_data, m365_data, mind_data):
    """Merge gathered data into the dashboard JSON structure."""
    do_all = 'all' in sections

    # Preserve existing config or create default
    config = existing.get('config', {
        'timezone': 'America/New_York',
        'refreshIntervals': {'ado': 21600, 'm365': 3600, 'mind': 0, 'calendar': 3600},
        'dashboardPort': 9999,
    })

    meta = existing.get('meta', {'lastRefreshed': {}})
    refreshed = meta.get('lastRefreshed', {})
    now = iso_now()

    # Start from existing data
    overview = existing.get('overview', {
        'focusRecs': [], 'mentions': [], 'openQuestions': [],
        'decisions': [], 'actionItems': [],
    })
    schedule = existing.get('schedule', {
        'todayMeetings': [], 'yesterdayRecaps': [], 'oneOnOnePrep': [],
    })
    ado_section = existing.get('ado', {
        'currentPeriod': {'label': 'This Period', 'items': []},
        'futureAdo': [], 'adoCleanup': [], 'agingItems': [],
        'recentlyCompleted': [], 'stateChanges': [],
    })
    comms = existing.get('comms', {
        'urgentEmails': [], 'awaitingReply': [], 'knowledgeDrops': [],
        'inboxNotes': [], 'activeInitiatives': [], 'nextActions': [],
    })
    # Merge ADO
    if do_all or 'ado' in sections:
        if ado_data:
            ado_section = ado_data
            refreshed['ado'] = now

    # Merge Calendar
    if do_all or 'calendar' in sections:
        if calendar_data:
            schedule['todayMeetings'] = calendar_data.get('todayMeetings', [])
            # Only replace yesterday recaps if we have them
            if calendar_data.get('yesterdayRecaps'):
                schedule['yesterdayRecaps'] = calendar_data['yesterdayRecaps']
            refreshed['calendar'] = now

    # Merge M365 (M365 query tool)
    if do_all or 'm365' in sections:
        if m365_data:
            overview['mentions'] = m365_data.get('mentions', [])
            overview['openQuestions'] = m365_data.get('openQuestions', [])
            overview['decisions'] = m365_data.get('decisions', [])
            overview['actionItems'] = m365_data.get('actionItems', [])
            comms['urgentEmails'] = m365_data.get('urgentEmails', [])
            comms['awaitingReply'] = m365_data.get('awaitingReply', [])
            comms['knowledgeDrops'] = m365_data.get('knowledgeDrops', [])
            # Merge yesterday recaps from M365 query tool into schedule
            if m365_data.get('yesterdayRecaps'):
                schedule['yesterdayRecaps'] = m365_data['yesterdayRecaps']
            refreshed['m365'] = now

    # Merge Mind
    if do_all or 'mind' in sections:
        if mind_data:
            comms['activeInitiatives'] = mind_data.get('activeInitiatives', [])
            comms['nextActions'] = mind_data.get('nextActions', [])
            comms['inboxNotes'] = mind_data.get('inboxNotes', [])
            refreshed['mind'] = now

    # Compute focus recs (uses cross-section data)
    overview['focusRecs'] = compute_focus_recs(
        ado_section, schedule,
        {'urgentEmails': comms.get('urgentEmails', [])},
    )

    meta['lastRefreshed'] = refreshed

    return {
        'config': config,
        'meta': meta,
        'overview': overview,
        'schedule': schedule,
        'ado': ado_section,
        'comms': comms,
    }


# ── CLI & main ───────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description='Daily dashboard data gatherer')
    p.add_argument('--org', default=os.environ.get('ADO_ORG', 'https://dev.azure.com/{your-org}'))
    p.add_argument('--project', '-p', default=os.environ.get('ADO_PROJECT', '{your-project}'))
    p.add_argument('--area', '-a', default=os.environ.get('ADO_AREA', r'{your-area-path}'))
    p.add_argument('--output', '-o', default=None,
                   help='Output JSON path (default: .github/extensions/canvas/data/content/dashboard-data.json)')
    p.add_argument('--mind', default=None,
                   help='Mind repo root (default: cwd)')
    p.add_argument('--sections', default='all',
                   help='Comma-separated sections to refresh: ado,m365,mind,calendar,all')
    p.add_argument('--period', default=None,
                   help='Current period iteration prefix for bucketing (e.g., {your-team})')
    p.add_argument('--calendar-json', default=None,
                   help='Path to pre-fetched calendar JSON (agent provides via MCP tools)')
    return p.parse_args()


def main():
    args = parse_args()

    sections = {s.strip().lower() for s in args.sections.split(',')}
    do_all = 'all' in sections

    mind_root = args.mind or os.getcwd()
    output_path = args.output or os.path.join(
        mind_root, '.github', 'extensions', 'canvas', 'data', 'content',
        'dashboard-data.json')

    log(f'Dashboard data gatherer — {eastern_now().strftime("%A %B %d, %Y %I:%M %p")} ET')
    log(f'Sections: {", ".join(sorted(sections))}')

    # ── Acquire tokens (parallel) ──
    ado_token = None
    graph_token = None

    need_ado = do_all or 'ado' in sections
    need_graph = (do_all or 'calendar' in sections) and not args.calendar_json
    need_m365 = do_all or 'm365' in sections
    need_mind = do_all or 'mind' in sections

    if need_ado:
        log('Acquiring ADO token...')
        try:
            ado_token = get_token(ADO_RESOURCE)
        except SystemExit:
            log('WARNING: ADO token failed — skipping ADO section')
            need_ado = False

    if need_graph:
        log('Acquiring Graph token...')
        try:
            graph_token = get_token(GRAPH_RESOURCE)
        except SystemExit:
            log('WARNING: Graph token failed — skipping calendar section')
            log('  TIP: az CLI token lacks Calendar.Read scope. Use --calendar-json instead.')
            need_graph = False

    # ── Load pre-fetched calendar if provided ──
    pre_calendar = None
    if args.calendar_json:
        try:
            with open(args.calendar_json, 'r', encoding='utf-8') as f:
                pre_calendar = json.load(f)
            log(f'Calendar: loaded from {args.calendar_json}')
        except Exception as e:
            log(f'WARNING: failed to load --calendar-json: {e}')

    # ── Gather data in parallel ──
    ado_data = None
    calendar_data = None
    m365_data = None
    mind_data = None

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {}

        if need_ado and ado_token:
            futures['ado'] = pool.submit(_safe_gather, 'ADO',
                                         gather_ado, args, ado_token)

        if need_graph and graph_token:
            futures['calendar'] = pool.submit(_safe_gather, 'Calendar',
                                              gather_calendar, graph_token)

        if need_mind:
            futures['mind'] = pool.submit(_safe_gather, 'Mind',
                                          gather_mind, mind_root)

        # Wait for ADO to finish before starting M365 (needs work items context)
        if 'ado' in futures:
            ado_data = futures['ado'].result()

    # M365 depends on ADO context, run after ADO completes
    if need_m365:
        ctx = build_work_items_context(ado_data) if ado_data else ''
        m365_data = _safe_gather('M365', gather_m365, ctx)

    # Collect remaining results
    if pre_calendar:
        calendar_data = pre_calendar
    elif 'calendar' in futures:
        calendar_data = futures.get('calendar').result()
    if 'mind' in futures:
        mind_data = futures.get('mind').result()

    # ── Load existing & merge ──
    existing = load_existing(output_path)
    dashboard = merge_dashboard(existing, sections,
                                ado_data, calendar_data, m365_data, mind_data)

    write_atomic(dashboard, output_path)
    log('Done.')


def _safe_gather(label, fn, *args, **kwargs):
    """Wrap a gather function with error handling."""
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        log(f'ERROR in {label}: {e}')
        return None


if __name__ == '__main__':
    main()
