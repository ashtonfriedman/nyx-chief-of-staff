import { fileURLToPath } from 'node:url';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SUMMARY_RE = /^\d{4}-\d{2}-\d{2}-summary\.md$/;
const VALID_REASONS = new Set(['transcript-pending','summarizer-failed','cancelled','holiday','no-recording','malformed-transcript','abandoned','ingested']);
const RETRYABLE = new Set(['transcript-pending','summarizer-failed']);
const SKIP_NORMAL = new Set(['cancelled','holiday','abandoned','ingested']);

function assertDate(date, field = 'date') {
  if (typeof date !== 'string' || !DATE_RE.test(date)) throw new Error(`invalid ${field}`);
}

function parseDate(date) {
  assertDate(date);
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dayOfWeek(date) {
  return parseDate(date).getUTCDay();
}

function isBusinessDay(date) {
  const d = dayOfWeek(date);
  return d >= 1 && d <= 5;
}

function isStandupFallbackDate(date) {
  const d = dayOfWeek(date);
  return d === 1 || d === 3 || d === 4;
}

function businessDaysBackInclusive(today, count) {
  assertDate(today, 'today');
  const out = [];
  let cursor = parseDate(today);
  while (out.length < count) {
    const value = formatDate(cursor);
    if (isBusinessDay(value)) out.push(value);
    cursor = addDays(cursor, -1);
  }
  return out;
}

function businessDaysBetweenInclusive(start, end) {
  assertDate(start, 'start');
  assertDate(end, 'end');
  let cursor = parseDate(start);
  const limit = parseDate(end);
  let count = 0;
  while (cursor <= limit) {
    const value = formatDate(cursor);
    if (isBusinessDay(value)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

function normalizeLabel(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function sanitizeMarkdownInline(value) {
  return String(value ?? '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s*#+\s*/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\[\[/g, '')
    .replace(/\]\]/g, '')
    .replace(/---/g, '')
    .replace(/`+/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIndexSummaryDates(markdown) {
  if (typeof markdown !== 'string') throw new Error('standupIndexMarkdown must be string');
  const found = new Set();
  const re = /\[\[(\d{4}-\d{2}-\d{2}-summary)\]\]/g;
  let match;
  while ((match = re.exec(markdown)) !== null) found.add(match[1].slice(0, 10));
  return [...found].sort().reverse();
}

function datesFromFilenames(files = []) {
  if (!Array.isArray(files)) throw new Error('existingSummaryFilenames must be array');
  return [...new Set(files.filter((f) => typeof f === 'string' && SUMMARY_RE.test(f)).map((f) => f.slice(0, 10)))].sort().reverse();
}

function cloneLedger(ledger) {
  return ledger.map((e) => ({ ...e }));
}

export function validateLedger(ledger) {
  if (ledger == null) return { ok: true, ledger: [] };
  if (typeof ledger === 'string') {
    try { ledger = JSON.parse(ledger); } catch { return { ok: false, error: 'ledger-invalid', ledger }; }
  }
  if (!Array.isArray(ledger)) return { ok: false, error: 'ledger-invalid', ledger };
  const seen = new Set();
  for (const entry of ledger) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'ledger-invalid', ledger };
    if (!DATE_RE.test(entry.date || '') || !VALID_REASONS.has(entry.reason)) return { ok: false, error: 'ledger-invalid', ledger };
    if (seen.has(entry.date)) return { ok: false, error: 'ledger-invalid', ledger };
    seen.add(entry.date);
    if (!Number.isInteger(entry.attempts) || entry.attempts < 0) return { ok: false, error: 'ledger-invalid', ledger };
    if (typeof entry.firstChecked !== 'string' || typeof entry.lastChecked !== 'string') return { ok: false, error: 'ledger-invalid', ledger };
  }
  return { ok: true, ledger: cloneLedger(ledger) };
}

function retryEligible(entry, today) {
  if (!RETRYABLE.has(entry.reason)) return false;
  const last = String(entry.lastChecked || '').slice(0, 10);
  if (last === today) return false;
  const first = String(entry.firstChecked || '').slice(0, 10);
  if (!DATE_RE.test(first)) return false;
  return businessDaysBetweenInclusive(first, today) <= 3;
}

function retryExpired(entry, today) {
  if (!RETRYABLE.has(entry.reason)) return false;
  const first = String(entry.firstChecked || '').slice(0, 10);
  if (!DATE_RE.test(first)) return false;
  return businessDaysBetweenInclusive(first, today) > 3;
}

export function plan(input = {}) {
  const today = input.today;
  assertDate(today, 'today');
  const maxLookbackBusinessDays = input.maxLookbackBusinessDays ?? 10;
  const maxFetchAttempts = input.maxFetchAttempts ?? 2;
  const backfillMode = Boolean(input.backfillMode);
  const ledgerCheck = validateLedger(input.ledger ?? []);
  if (!ledgerCheck.ok) return { error: 'ledger-invalid', ledger: ledgerCheck.ledger, fetchCandidates: [], existingSummaries: [], indexRepairs: [], ledgerUpdates: [], ledgerRepairs: [], warnings: ['ledger invalid; fail closed'] };

  const fileDates = datesFromFilenames(input.existingSummaryFilenames ?? []);
  const indexDates = parseIndexSummaryDates(input.standupIndexMarkdown ?? '');
  const summaryDates = [...new Set([...fileDates, ...indexDates])].sort().reverse();
  const fileSet = new Set(fileDates);
  const indexSet = new Set(indexDates);
  const indexRepairs = fileDates.filter((d) => !indexSet.has(d)).map((date) => ({ date, entry: `- [[${date}-summary]]`, reason: 'missing-index-entry' }));
  const warnings = [];
  for (const d of indexDates) if (!fileSet.has(d)) warnings.push(`index entry has no matching summary file: ${d}`);

  const lookbackDates = businessDaysBackInclusive(today, maxLookbackBusinessDays);
  const lowerBound = lookbackDates[lookbackDates.length - 1];
  let expected;
  if (Array.isArray(input.calendarOccurrences) && input.calendarOccurrences.length > 0) {
    expected = [...new Set(input.calendarOccurrences
      .map((o) => typeof o === 'string' ? o : o?.date)
      .filter((d) => DATE_RE.test(d || '') && d >= lowerBound && d <= today))].sort().reverse();
  } else {
    expected = lookbackDates.filter(isStandupFallbackDate).sort().reverse();
  }

  const byDate = new Map(ledgerCheck.ledger.map((e) => [e.date, e]));
  const ledgerRepairs = [];
  const ledgerUpdates = [];
  for (const entry of ledgerCheck.ledger) {
    if (fileSet.has(entry.date) && entry.reason !== 'ingested') ledgerRepairs.push({ date: entry.date, from: entry.reason, to: 'ingested', reason: 'summary-exists' });
    if (retryExpired(entry, today) && !fileSet.has(entry.date) && entry.reason !== 'abandoned') ledgerUpdates.push({ date: entry.date, from: entry.reason, to: 'abandoned', reason: 'retry-window-expired' });
  }

  const newCandidates = [];
  const retryCandidates = [];
  for (const date of expected) {
    if (fileSet.has(date)) continue;
    const entry = byDate.get(date);
    if (!entry) { newCandidates.push({ date, source: 'expected', reason: 'missing-summary' }); continue; }
    if (SKIP_NORMAL.has(entry.reason) && !(backfillMode && entry.reason === 'abandoned')) continue;
    if (entry.reason === 'abandoned' && backfillMode) { retryCandidates.push({ date, source: 'ledger', reason: 'abandoned-backfill', attempts: entry.attempts }); continue; }
    if (retryEligible(entry, today)) retryCandidates.push({ date, source: 'ledger', reason: entry.reason, attempts: entry.attempts });
  }

  const sortedNew = newCandidates.sort((a, b) => b.date.localeCompare(a.date));
  const sortedRetry = retryCandidates.sort((a, b) => b.date.localeCompare(a.date));
  const orderedCandidates = [
    ...sortedNew.slice(0, 1),
    ...sortedRetry,
    ...sortedNew.slice(1),
  ];
  const fetchCandidates = orderedCandidates
    .filter((c, i, arr) => arr.findIndex((x) => x.date === c.date) === i)
    .slice(0, maxFetchAttempts);

  return { fetchCandidates, existingSummaries: summaryDates, indexRepairs, ledgerUpdates, ledgerRepairs, warnings };
}

function isUnsafeFolder(folder) {
  return typeof folder === 'string'
    && folder !== 'SELF'
    && (!folder.startsWith('domains/people/') || folder.includes('..') || /(^|[/\\])\.\.([/\\]|$)/.test(folder));
}

export function validateAttendeeMap(attendeeMap = []) {
  const mapErrors = [];
  if (!Array.isArray(attendeeMap)) return { mapErrors: ['attendeeMap must be array'], aliasToEntries: new Map() };
  const aliasToEntries = new Map();
  attendeeMap.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') { mapErrors.push(`entry ${index}: invalid object`); return; }
    if (!Array.isArray(entry.aliases) || entry.aliases.length === 0) mapErrors.push(`entry ${index}: aliases required`);
    if (typeof entry.display !== 'string' || !entry.display.trim()) mapErrors.push(`entry ${index}: display required`);
    const folder = entry.folder;
    let folderUnsafe = false;
    if (!(folder === null || folder === 'SELF' || typeof folder === 'string')) mapErrors.push(`entry ${index}: invalid folder`);
    if (typeof folder === 'string' && folder !== 'SELF') {
      if (!folder.startsWith('domains/people/')) { mapErrors.push(`entry ${index}: folder outside domains/people`); folderUnsafe = true; }
      if (folder.includes('..') || /(^|[/\\])\.\.([/\\]|$)/.test(folder)) { mapErrors.push(`entry ${index}: folder traversal`); folderUnsafe = true; }
    }
    const local = new Set();
    for (const alias of entry.aliases ?? []) {
      const norm = normalizeLabel(alias);
      if (!norm) { mapErrors.push(`entry ${index}: empty alias`); continue; }
      if (local.has(norm)) mapErrors.push(`entry ${index}: duplicate alias ${alias}`);
      local.add(norm);
      if (!aliasToEntries.has(norm)) aliasToEntries.set(norm, []);
      aliasToEntries.get(norm).push({ ...entry, index, folderUnsafe });
    }
  });
  for (const [alias, entries] of aliasToEntries.entries()) if (entries.length > 1) mapErrors.push(`alias collision: ${alias}`);
  return { mapErrors, aliasToEntries };
}

export function resolveSpeakers(input = {}) {
  const { mapErrors, aliasToEntries } = validateAttendeeMap(input.attendeeMap ?? []);
  const speakerLabels = Array.isArray(input.speakerLabels) ? input.speakerLabels : [];
  const resolved = [];
  const unrecognized = [];
  const ambiguous = [];
  for (const raw of speakerLabels) {
    const label = String(raw ?? '').trim().replace(/\s+/g, ' ');
    const norm = normalizeLabel(label);
    const matches = aliasToEntries.get(norm) ?? [];
    if (matches.length === 1) {
      const entry = matches[0];
      resolved.push({ label, display: entry.display, folder: entry.folder, folderUnsafe: Boolean(entry.folderUnsafe), breadcrumbEligible: Boolean(entry.folder && entry.folder !== 'SELF' && !entry.folderUnsafe) });
    } else if (matches.length > 1) {
      ambiguous.push({ label, matches: matches.map((m) => ({ display: m.display, folder: m.folder })) });
    } else {
      unrecognized.push(label);
    }
  }
  return { resolved, unrecognized, ambiguous, mapErrors };
}

function displayMap(attendeeMap = []) {
  const m = new Map();
  const { aliasToEntries } = validateAttendeeMap(attendeeMap);
  const seen = new Set();
  for (const entries of aliasToEntries.values()) {
    for (const e of entries) {
      if (seen.has(e.index)) continue;
      seen.add(e.index);
      if (e && typeof e.display === 'string') m.set(normalizeLabel(e.display), e);
    }
  }
  return m;
}

function parseSummarySections(markdown) {
  const sections = [];
  const re = /^##\s+(.+)\s*$/gm;
  let match;
  while ((match = re.exec(markdown)) !== null) sections.push(sanitizeMarkdownInline(match[1]));
  return sections;
}

export function reconcile(input = {}) {
  const latestSummaryDate = input.latestSummaryDate;
  assertDate(latestSummaryDate, 'latestSummaryDate');
  const summaryMarkdown = input.summaryMarkdown ?? '';
  const hasH1 = new RegExp(`^#\\s+Team Standup\\b[^\\n—]*—\\s+${latestSummaryDate}`, 'm').test(summaryMarkdown);
  const sections = parseSummarySections(summaryMarkdown);
  const hasCanonicalSection = sections.some((s) => s === 'Team-wide' || (!s.startsWith('Guest:') && s.length > 0));
  const indexDates = parseIndexSummaryDates(input.standupIndexMarkdown ?? '');
  const indexRepairNeeded = !indexDates.includes(latestSummaryDate);
  const warnings = [];
  if (!hasH1 || !hasCanonicalSection) return { invalidSummary: true, indexRepairNeeded, breadcrumbRepairs: [], skippedBreadcrumbs: [], warnings: ['invalid-summary'] };

  const byDisplay = displayMap(input.attendeeMap ?? []);
  const personIndexMarkdownByFolder = input.personIndexMarkdownByFolder ?? {};
  const breadcrumbRepairs = [];
  const skippedBreadcrumbs = [];
  for (const section of sections) {
    if (section === 'Team-wide' || section.startsWith('Guest:')) continue;
    const entry = byDisplay.get(normalizeLabel(section));
    if (!entry) { skippedBreadcrumbs.push({ display: section, reason: 'not-in-attendee-map' }); continue; }
    if (entry.folder === null) { skippedBreadcrumbs.push({ display: entry.display, reason: 'no-folder' }); continue; }
    if (entry.folder === 'SELF') { skippedBreadcrumbs.push({ display: entry.display, reason: 'self' }); continue; }
    if (entry.folderUnsafe || isUnsafeFolder(entry.folder)) { skippedBreadcrumbs.push({ display: entry.display, folder: entry.folder, reason: 'folder-unsafe' }); continue; }
    const content = personIndexMarkdownByFolder[entry.folder];
    if (typeof content !== 'string') { skippedBreadcrumbs.push({ display: entry.display, folder: entry.folder, reason: 'missing-index' }); continue; }
    const expectedLink = `[[<STANDUP_FOLDER>/${latestSummaryDate}-summary#${entry.display}]]`;
    const latestSection = extractLatestStandup(content);
    if (!latestSection || !latestSection.includes(`${latestSummaryDate} —`) || !latestSection.includes(expectedLink)) {
      breadcrumbRepairs.push({ display: entry.display, folder: entry.folder, date: latestSummaryDate, expectedLink });
    }
  }
  return { invalidSummary: false, indexRepairNeeded, breadcrumbRepairs, skippedBreadcrumbs, warnings };
}

function splitLinesPreserveFinal(markdown) {
  return String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
}

function extractLatestStandup(markdown) {
  const lines = splitLinesPreserveFinal(markdown);
  const start = lines.findIndex((l) => /^##\s+Latest Standup\s*$/.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join('\n');
}

export function upsertLatest(input = {}) {
  const original = String(input.personIndexMarkdown ?? '').replace(/\r\n/g, '\n');
  const breadcrumb = String(input.breadcrumbMarkdown ?? '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const block = `## Latest Standup\n${breadcrumb}`;
  const lines = original.split('\n');
  let start = lines.findIndex((l) => /^##\s+Latest Standup\s*$/.test(l));
  let end;
  let replacedSpan = false;
  if (start >= 0) {
    end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) if (/^##\s+/.test(lines[i])) { end = i; break; }
    replacedSpan = true;
  } else {
    let insertAt = 0;
    if (lines[0] === '---') {
      const fmEnd = lines.findIndex((l, i) => i > 0 && l === '---');
      if (fmEnd >= 0) insertAt = fmEnd + 1;
    }
    while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt += 1;
    if (/^#\s+/.test(lines[insertAt] ?? '')) insertAt += 1;
    while (insertAt < lines.length && lines[insertAt].trim() === '') insertAt += 1;
    const firstH2 = lines.findIndex((l, i) => i >= insertAt && /^##\s+/.test(l));
    start = firstH2 >= 0 ? firstH2 : insertAt;
    end = start;
  }
  const newLines = [...lines.slice(0, start), ...block.split('\n'), '', ...lines.slice(end)];
  let updatedMarkdown = newLines.join('\n').replace(/\n{3,}/g, '\n\n');
  if (!updatedMarkdown.endsWith('\n')) updatedMarkdown += '\n';
  const normalizedOriginal = original.endsWith('\n') ? original : `${original}\n`;
  return { updatedMarkdown, replacedSpan, changed: updatedMarkdown !== normalizedOriginal };
}

export function validateSubagentOutput(input = {}) {
  let value = input;
  if (input && typeof input === 'object' && Object.hasOwn(input, 'raw')) value = input.raw;
  if (input && typeof input === 'object' && Object.hasOwn(input, 'value')) value = input.value;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return { ok: false, error: 'invalid-json' }; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'not-object' };

  const required = ['date', 'transcriptComplete', 'speakers', 'teamWide', 'oofNames'];
  const allowed = new Set(required);
  const keys = Object.keys(value);
  const unknown = keys.filter((k) => !allowed.has(k));
  if (unknown.length) return { ok: false, error: `unknown-field:${unknown[0]}` };
  const missing = required.filter((k) => !Object.hasOwn(value, k));
  if (missing.length) return { ok: false, error: `missing-field:${missing[0]}` };
  if (!DATE_RE.test(value.date)) return { ok: false, error: 'invalid-date' };
  if (typeof value.transcriptComplete !== 'boolean') return { ok: false, error: 'invalid-transcriptComplete' };
  if (!Array.isArray(value.speakers)) return { ok: false, error: 'invalid-speakers' };
  for (const speaker of value.speakers) {
    if (!speaker || typeof speaker !== 'object' || Array.isArray(speaker)) return { ok: false, error: 'invalid-speaker' };
    const speakerKeys = Object.keys(speaker);
    if (speakerKeys.some((k) => !['label', 'bullets'].includes(k))) return { ok: false, error: 'invalid-speaker-field' };
    if (typeof speaker.label !== 'string' || !Array.isArray(speaker.bullets) || speaker.bullets.some((b) => typeof b !== 'string')) return { ok: false, error: 'invalid-speaker-shape' };
  }
  if (!Array.isArray(value.teamWide) || value.teamWide.some((b) => typeof b !== 'string')) return { ok: false, error: 'invalid-teamWide' };
  if (!Array.isArray(value.oofNames) || value.oofNames.some((b) => typeof b !== 'string')) return { ok: false, error: 'invalid-oofNames' };
  return { ok: true, value };
}

export function ledgerUpdate(input = {}) {
  const date = input.date;
  const reason = input.reason;
  const now = input.now ?? new Date().toISOString();
  if (!DATE_RE.test(date || '') || !VALID_REASONS.has(reason)) return { error: 'ledger-invalid', ledger: input.ledger };
  const check = validateLedger(input.ledger ?? []);
  if (!check.ok) return { error: 'ledger-invalid', ledger: check.ledger };
  const ledger = cloneLedger(check.ledger).filter((e) => e.date !== date);
  const existing = check.ledger.find((e) => e.date === date);
  let next;
  if (existing) {
    next = { ...existing, reason, lastChecked: now, attempts: (existing.attempts ?? 0) + 1 };
    if (!next.firstChecked) next.firstChecked = now;
  } else {
    next = { date, reason, firstChecked: now, lastChecked: now, attempts: 1 };
  }
  if (retryExpired(next, now.slice(0, 10)) && RETRYABLE.has(reason)) {
    next.reason = 'abandoned';
    next.abandonedOn = now;
  }
  ledger.push(next);
  ledger.sort((a, b) => b.date.localeCompare(a.date));
  return { ledger, changed: JSON.stringify(ledger) !== JSON.stringify(check.ledger) };
}

export function dispatch(mode, input) {
  switch (mode) {
    case 'plan': return plan(input);
    case 'resolve-speakers': return resolveSpeakers(input);
    case 'reconcile': return reconcile(input);
    case 'upsert-latest': return upsertLatest(input);
    case 'ledger-update': return ledgerUpdate(input);
    case 'validate-subagent-output': return validateSubagentOutput(input);
    case 'sanitize': return { value: sanitizeMarkdownInline(input?.value) };
    default: throw new Error(`unknown mode: ${mode}`);
  }
}

async function main() {
  let payloadText = process.argv[3];
  const modeArg = process.argv[2];
  if (!payloadText) {
    payloadText = await new Promise((resolve) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { data += chunk; });
      process.stdin.on('end', () => resolve(data));
    });
  }
  let payload;
  try { payload = payloadText ? JSON.parse(payloadText) : {}; } catch (error) {
    console.error(JSON.stringify({ error: 'invalid-json' }));
    process.exit(1);
  }
  const mode = modeArg && modeArg !== '-' ? modeArg : payload.mode;
  const input = payload.input ?? payload;
  try {
    process.stdout.write(`${JSON.stringify(dispatch(mode, input), null, 2)}\n`);
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
