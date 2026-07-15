import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  plan,
  resolveSpeakers,
  reconcile,
  upsertLatest,
  ledgerUpdate,
  validateLedger,
  validateSubagentOutput,
  sanitizeMarkdownInline,
} from './standup-helper.mjs';

const helperPath = new URL('./standup-helper.mjs', import.meta.url).pathname.replace(/^\/(.:)/, '$1');

function attendeeMap(extra = []) {
  return [
    { aliases: ['Riley', 'Riley Adams'], display: 'Riley', folder: 'domains/people/directs/riley' },
    { aliases: ['Andre Costa'], display: 'Andre Costa', folder: 'domains/people/directs/andre-costa' },
    { aliases: ['Carter', 'Morgan Carter'], display: 'Carter', folder: 'domains/people/directs/carter' },
    { aliases: ['Devin'], display: 'Devin', folder: 'domains/people/directs/devin' },
    { aliases: ['Jordan Pike'], display: 'Jordan Pike', folder: 'domains/people/directs/jordan-pike' },
    { aliases: ['Sasha'], display: 'Sasha', folder: 'domains/people/directs/sasha' },
    { aliases: ['Jamie Lowe'], display: 'Jamie Lowe', folder: null },
    { aliases: ['Self'], display: 'Self', folder: 'SELF' },
    ...extra,
  ];
}

function indexMarkdown(dates = []) {
  return `# Team Standup\n\n## Summaries\n${dates.map((d) => `- [[${d}-summary]]`).join('\n')}\n`;
}

function summary(date = '2026-06-03') {
  return `# Team Standup — ${date} (Wed)\n\nSource: M365 query tool transcript — speaker attribution per transcript, not verified.\n\n## Carter\n- Fixed auth flow.\n\n## Riley\n- Board grooming.\n\n## Team-wide\n- Deploy hold lifted.\n`;
}

function personIndex(lineDate = '2026-05-27', display = 'Carter') {
  return `# Person\n\n## Latest Standup\n${lineDate} — Old. → [[<STANDUP_FOLDER>/${lineDate}-summary#${display}]]\n\n## Open Threads\n- Keep me.\n`;
}

test('plan detects missing Mon/Wed standups, excludes Fri/weekends/Tue, and caps at two newest candidates', () => {
  const out = plan({
    today: '2026-06-03',
    standupIndexMarkdown: indexMarkdown(['2026-05-28']),
    existingSummaryFilenames: ['2026-05-28-summary.md'],
    ledger: [],
    maxLookbackBusinessDays: 10,
    maxFetchAttempts: 2,
  });
  assert.deepEqual(out.fetchCandidates.map((c) => c.date), ['2026-06-03', '2026-06-01']);
  assert.equal(out.fetchCandidates.length, 2);
  assert.ok(!out.fetchCandidates.some((c) => ['2026-05-29', '2026-05-30', '2026-05-31', '2026-06-02'].includes(c.date)));
});

test('plan uses calendar occurrences when provided', () => {
  const out = plan({ today: '2026-06-03', calendarOccurrences: [{ date: '2026-06-02' }], standupIndexMarkdown: indexMarkdown([]), existingSummaryFilenames: [], ledger: [] });
  assert.deepEqual(out.fetchCandidates.map((c) => c.date), ['2026-06-02']);
});

test('plan orders newest not-yet-attempted candidates before eligible retries and prevents same-day retry thrash', () => {
  const out = plan({
    today: '2026-06-04',
    standupIndexMarkdown: indexMarkdown([]),
    existingSummaryFilenames: [],
    ledger: [
      { date: '2026-06-01', reason: 'transcript-pending', firstChecked: '2026-06-02T14:00:00Z', lastChecked: '2026-06-02T14:00:00Z', attempts: 1 },
      { date: '2026-06-03', reason: 'transcript-pending', firstChecked: '2026-06-03T14:00:00Z', lastChecked: '2026-06-04T14:00:00Z', attempts: 1 },
    ],
    maxFetchAttempts: 2,
  });
  assert.deepEqual(out.fetchCandidates.map((c) => c.date), ['2026-06-04', '2026-06-01']);
});

test('plan detects index repair, summary-wins ledger repair, abandoned skip, and nothing-to-do convergence', () => {
  const out = plan({
    today: '2026-06-03',
    standupIndexMarkdown: indexMarkdown(['2026-06-03', '2026-05-27', '2026-05-25', '2026-05-21']),
    existingSummaryFilenames: ['2026-06-03-summary.md', '2026-06-01-summary.md', '2026-05-27-summary.md', '2026-05-25-summary.md', '2026-05-21-summary.md'],
    ledger: [
      { date: '2026-06-01', reason: 'transcript-pending', firstChecked: '2026-06-01T14:00:00Z', lastChecked: '2026-06-01T14:00:00Z', attempts: 1 },
      { date: '2026-05-28', reason: 'abandoned', firstChecked: '2026-05-28T14:00:00Z', lastChecked: '2026-06-02T14:00:00Z', attempts: 3 },
    ],
  });
  assert.deepEqual(out.indexRepairs.map((r) => r.date), ['2026-06-01']);
  assert.deepEqual(out.ledgerRepairs.map((r) => r.date), ['2026-06-01']);
  assert.deepEqual(out.fetchCandidates, []);
});

test('plan backfill includes abandoned dates', () => {
  const out = plan({ today: '2026-06-04', standupIndexMarkdown: indexMarkdown([]), existingSummaryFilenames: [], backfillMode: true, ledger: [{ date: '2026-06-03', reason: 'abandoned', firstChecked: '2026-06-01T00:00:00Z', lastChecked: '2026-06-03T00:00:00Z', attempts: 3 }] });
  assert.ok(out.fetchCandidates.some((c) => c.date === '2026-06-03' && c.reason === 'abandoned-backfill'));
});

test('plan emits pending-to-abandoned ledgerUpdates when retry window is expired and no summary exists', () => {
  const out = plan({
    today: '2026-06-04',
    standupIndexMarkdown: indexMarkdown([]),
    existingSummaryFilenames: [],
    ledger: [{ date: '2026-05-28', reason: 'transcript-pending', firstChecked: '2026-05-28T14:00:00Z', lastChecked: '2026-05-29T14:00:00Z', attempts: 2 }],
  });
  assert.deepEqual(out.ledgerUpdates, [{ date: '2026-05-28', from: 'transcript-pending', to: 'abandoned', reason: 'retry-window-expired' }]);
});

test('plan fully clean nothing-to-do path has no candidates, repairs, or updates', () => {
  const dates = ['2026-06-04', '2026-06-03', '2026-06-01', '2026-05-28', '2026-05-27', '2026-05-25', '2026-05-21'];
  const out = plan({
    today: '2026-06-04',
    standupIndexMarkdown: indexMarkdown(dates),
    existingSummaryFilenames: dates.map((d) => `${d}-summary.md`),
    ledger: [],
  });
  assert.deepEqual(out.fetchCandidates, []);
  assert.deepEqual(out.indexRepairs, []);
  assert.deepEqual(out.ledgerUpdates, []);
  assert.deepEqual(out.ledgerRepairs, []);
});

test('resolve-speakers uses exact case-insensitive alias matching and no substring matches', () => {
  const out = resolveSpeakers({ speakerLabels: ['  morgan   carter ', 'Morgan Guest', 'Carter'], attendeeMap: attendeeMap() });
  assert.deepEqual(out.resolved.map((r) => r.display), ['Carter', 'Carter']);
  assert.deepEqual(out.unrecognized, ['Morgan Guest']);
});

test('resolve-speakers handles null folder, SELF, unrecognized labels, and absent attendees without fabrication', () => {
  const out = resolveSpeakers({ speakerLabels: ['Jamie Lowe', 'Self', 'Unknown Person'], attendeeMap: attendeeMap() });
  assert.equal(out.resolved.find((r) => r.display === 'Jamie Lowe').breadcrumbEligible, false);
  assert.equal(out.resolved.find((r) => r.display === 'Self').breadcrumbEligible, false);
  assert.deepEqual(out.unrecognized, ['Unknown Person']);
  assert.ok(!out.resolved.some((r) => r.display === 'Sasha'));
});

test('resolve-speakers reports alias collisions, duplicate aliases, and traversal folders', () => {
  const out = resolveSpeakers({
    speakerLabels: ['Carter'],
    attendeeMap: attendeeMap([
      { aliases: ['Carter'], display: 'Other Carter', folder: 'domains/people/directs/other' },
      { aliases: ['Dup', ' dup '], display: 'Dup', folder: 'domains/people/../other' },
      { aliases: ['Bad'], display: 'Bad', folder: '../../../etc/passwd' },
    ]),
  });
  assert.equal(out.ambiguous[0].label, 'Carter');
  assert.ok(out.mapErrors.some((e) => e.includes('alias collision: carter')));
  assert.ok(out.mapErrors.some((e) => e.includes('duplicate alias')));
  assert.ok(out.mapErrors.some((e) => e.includes('folder traversal')));
  assert.ok(out.mapErrors.some((e) => e.includes('outside domains/people')));
});

test('resolve-speakers resolves unsafe folder but makes it breadcrumb-ineligible', () => {
  const out = resolveSpeakers({
    speakerLabels: ['Unsafe Person'],
    attendeeMap: [{ aliases: ['Unsafe Person'], display: 'Unsafe Person', folder: 'domains/people/../../etc' }],
  });
  assert.equal(out.resolved[0].display, 'Unsafe Person');
  assert.equal(out.resolved[0].breadcrumbEligible, false);
  assert.equal(out.resolved[0].folderUnsafe, true);
  assert.ok(out.mapErrors.some((e) => e.includes('folder traversal')));
});

test('sanitize strips markdown control characters and collapses transcript newlines', () => {
  const raw = '# Heading\n- [[link]] --- `code` | table |\nnext';
  assert.equal(sanitizeMarkdownInline(raw), 'Heading link code table next');
});

test('sanitize neutralizes markdown links and images', () => {
  const raw = 'See [click](http://evil) and ![logo](http://evil/image.png) plus [[wiki]].';
  const sanitized = sanitizeMarkdownInline(raw);
  assert.equal(sanitized, 'See click and logo plus wiki.');
  assert.ok(!sanitized.includes('http://'));
  assert.ok(!sanitized.includes(']('));
});

test('reconcile flags stale breadcrumb repairs and missing index entries for valid summaries', () => {
  const out = reconcile({
    latestSummaryDate: '2026-06-03',
    summaryMarkdown: summary(),
    standupIndexMarkdown: indexMarkdown([]),
    attendeeMap: attendeeMap(),
    personIndexMarkdownByFolder: {
      'domains/people/directs/carter': personIndex('2026-05-27', 'Carter'),
      'domains/people/directs/riley': personIndex('2026-06-03', 'Riley'),
    },
  });
  assert.equal(out.indexRepairNeeded, true);
  assert.deepEqual(out.breadcrumbRepairs.map((r) => r.display), ['Carter']);
});

test('reconcile recognizes all-current breadcrumbs and produces no repair', () => {
  const link = '2026-06-03 — Current. → [[<STANDUP_FOLDER>/2026-06-03-summary#Carter]]';
  const out = reconcile({ latestSummaryDate: '2026-06-03', summaryMarkdown: '# Team Standup — 2026-06-03 (Wed)\n\n## Carter\n- X\n', standupIndexMarkdown: indexMarkdown(['2026-06-03']), attendeeMap: attendeeMap(), personIndexMarkdownByFolder: { 'domains/people/directs/carter': `# P\n\n## Latest Standup\n${link}\n` } });
  assert.equal(out.indexRepairNeeded, false);
  assert.deepEqual(out.breadcrumbRepairs, []);
});

test('reconcile refuses invalid summaries and does not plan breadcrumb repairs', () => {
  const noH1 = reconcile({ latestSummaryDate: '2026-06-03', summaryMarkdown: '## Carter\n- X', standupIndexMarkdown: indexMarkdown([]), attendeeMap: attendeeMap(), personIndexMarkdownByFolder: {} });
  assert.equal(noH1.invalidSummary, true);
  assert.deepEqual(noH1.breadcrumbRepairs, []);
  const noSections = reconcile({ latestSummaryDate: '2026-06-03', summaryMarkdown: '# Team Standup — 2026-06-03 (Wed)\nOnly text', standupIndexMarkdown: indexMarkdown([]), attendeeMap: attendeeMap(), personIndexMarkdownByFolder: {} });
  assert.equal(noSections.invalidSummary, true);
});

test('reconcile accepts Monday sprint-planning H1 variant', () => {
  const out = reconcile({
    latestSummaryDate: '2026-06-15',
    summaryMarkdown: '# Team Standup / Sprint Planning — 2026-06-15 (Mon)\n\n## Carter\n- X\n\n## Team-wide\n- Y\n',
    standupIndexMarkdown: indexMarkdown(['2026-06-15']),
    attendeeMap: attendeeMap(),
    personIndexMarkdownByFolder: { 'domains/people/directs/carter': '# P\n' },
  });
  assert.equal(out.invalidSummary, false);
  assert.equal(out.breadcrumbRepairs.length, 1);
});

test('reconcile skips no-folder, SELF, guest, and missing person indexes', () => {
  const out = reconcile({
    latestSummaryDate: '2026-06-03',
    summaryMarkdown: '# Team Standup — 2026-06-03 (Wed)\n\n## Jamie Lowe\n- X\n\n## Self\n- X\n\n## Guest: Morgan Guest\n- X\n\n## Devin\n- X\n',
    standupIndexMarkdown: indexMarkdown(['2026-06-03']),
    attendeeMap: attendeeMap(),
    personIndexMarkdownByFolder: {},
  });
  assert.deepEqual(out.skippedBreadcrumbs.map((s) => s.reason), ['no-folder', 'self', 'missing-index']);
});

test('upsert-latest inserts after front matter and H1 while preserving curated content', () => {
  const original = '---\ntitle: Person\n---\n\n# Person\n\n## Open Threads\n- Keep me\n';
  const out = upsertLatest({ personIndexMarkdown: original, breadcrumbMarkdown: '2026-06-03 — New. → [[<STANDUP_FOLDER>/2026-06-03-summary#Carter]]' });
  assert.match(out.updatedMarkdown, /^---\ntitle: Person\n---\n\n# Person\n\n## Latest Standup\n2026-06-03/m);
  assert.ok(out.updatedMarkdown.includes('## Open Threads\n- Keep me'));
});

test('upsert-latest inserts before first H2 when absent and no front matter exists', () => {
  const out = upsertLatest({ personIndexMarkdown: '# Person\n\nIntro\n\n## Notes\n- Keep\n', breadcrumbMarkdown: '2026-06-03 — New.' });
  assert.ok(out.updatedMarkdown.indexOf('## Latest Standup') < out.updatedMarkdown.indexOf('## Notes'));
});

test('upsert-latest replaces only the Latest Standup span and stops at same-level H2, not H3', () => {
  const original = '# Person\n\n## Latest Standup\nOld\n### Nested\nStill old\n\n## Open Threads\n- Keep me\n';
  const out = upsertLatest({ personIndexMarkdown: original, breadcrumbMarkdown: '2026-06-03 — New.' });
  assert.ok(!out.updatedMarkdown.includes('Still old'));
  assert.ok(out.updatedMarkdown.includes('## Open Threads\n- Keep me'));
  assert.equal(out.replacedSpan, true);
});

test('upsert-latest reports changed false when breadcrumb already current', () => {
  const original = '# P\n\n## Latest Standup\n2026-06-03 — New.\n';
  const out = upsertLatest({ personIndexMarkdown: original, breadcrumbMarkdown: '2026-06-03 — New.' });
  assert.equal(out.changed, false);
});

test('upsert-latest replaces span through EOF', () => {
  const out = upsertLatest({ personIndexMarkdown: '# P\n\n## Latest Standup\nOld', breadcrumbMarkdown: '2026-06-03 — New.' });
  assert.equal(out.updatedMarkdown, '# P\n\n## Latest Standup\n2026-06-03 — New.\n');
});

test('upsert-latest flattens multi-line breadcrumbs to prevent sibling heading injection', () => {
  const out = upsertLatest({ personIndexMarkdown: '# P\n', breadcrumbMarkdown: '2026-06-03 — New.\n## Injected' });
  assert.equal((out.updatedMarkdown.match(/^##\s+/gm) ?? []).length, 1);
  assert.ok(out.updatedMarkdown.includes('2026-06-03 — New. ## Injected'));
});

test('ledger-update creates and increments retryable entries', () => {
  const first = ledgerUpdate({ ledger: [], date: '2026-06-01', reason: 'transcript-pending', now: '2026-06-01T14:00:00Z' });
  assert.equal(first.ledger[0].attempts, 1);
  const second = ledgerUpdate({ ledger: first.ledger, date: '2026-06-01', reason: 'transcript-pending', now: '2026-06-02T14:00:00Z' });
  assert.equal(second.ledger[0].attempts, 2);
  assert.equal(second.ledger[0].firstChecked, '2026-06-01T14:00:00Z');
});

test('ledger-update abandons transcript-pending and summarizer-failed after retry window', () => {
  const base = [{ date: '2026-05-28', reason: 'summarizer-failed', firstChecked: '2026-05-28T14:00:00Z', lastChecked: '2026-05-29T14:00:00Z', attempts: 2 }];
  const out = ledgerUpdate({ ledger: base, date: '2026-05-28', reason: 'summarizer-failed', now: '2026-06-03T14:00:00Z' });
  assert.equal(out.ledger[0].reason, 'abandoned');
  assert.ok(out.ledger[0].abandonedOn);
});

test('ledger validation rejects unknown reasons and malformed ledgers, preserving original', () => {
  assert.equal(validateLedger([{ date: '2026-06-01', reason: 'bogus', firstChecked: 'x', lastChecked: 'x', attempts: 1 }]).error, 'ledger-invalid');
  const original = '{bad json';
  const out = validateLedger(original);
  assert.equal(out.error, 'ledger-invalid');
  assert.equal(out.ledger, original);
});

test('ledger-update stores cancelled and holiday without retry conversion', () => {
  const out = ledgerUpdate({ ledger: [], date: '2026-06-01', reason: 'cancelled', now: '2026-06-10T14:00:00Z' });
  assert.equal(out.ledger[0].reason, 'cancelled');
});

test('validate-subagent-output accepts valid strict JSON object', () => {
  const valid = { date: '2026-06-03', transcriptComplete: true, speakers: [{ label: 'Carter', bullets: ['Built thing'] }], teamWide: ['Deploy hold'], oofNames: ['Andre Costa'] };
  assert.deepEqual(validateSubagentOutput(valid), { ok: true, value: valid });
});

test('validate-subagent-output rejects unknown top-level action key', () => {
  const out = validateSubagentOutput({ date: '2026-06-03', transcriptComplete: true, speakers: [], teamWide: [], oofNames: [], action: 'email' });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'unknown-field:action');
});

test('validate-subagent-output rejects missing speakers', () => {
  const out = validateSubagentOutput({ date: '2026-06-03', transcriptComplete: true, teamWide: [], oofNames: [] });
  assert.equal(out.ok, false);
  assert.equal(out.error, 'missing-field:speakers');
});

test('validate-subagent-output rejects wrong nested types and parses raw JSON strings', () => {
  const wrong = validateSubagentOutput({ date: '2026-06-03', transcriptComplete: true, speakers: [{ label: 'Carter', bullets: 'not array' }], teamWide: [], oofNames: [] });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, 'invalid-speaker-shape');
  const raw = validateSubagentOutput('{"date":"2026-06-03","transcriptComplete":false,"speakers":[],"teamWide":[],"oofNames":[]}');
  assert.equal(raw.ok, true);
});

test('CLI dispatch reads stdin JSON and rejects non-JSON stdin with non-zero exit', () => {
  const ok = spawnSync(process.execPath, [helperPath, 'sanitize'], { input: JSON.stringify({ value: '[[x]]' }), encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.deepEqual(JSON.parse(ok.stdout), { value: 'x' });
  const bad = spawnSync(process.execPath, [helperPath, 'sanitize'], { input: '{not json', encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
});
