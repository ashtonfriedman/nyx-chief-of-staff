import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCAN = path.join(__dirname, '..', 'lib', 'scan.js');
const FIXTURES = path.join(__dirname, 'fixtures');

function run(args) {
  return exec('node', [SCAN, ...args], {
    cwd: path.join(__dirname, '..'),
    timeout: 60_000,
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (e) => ({ code: e.code ?? 2, stdout: e.stdout || '', stderr: e.stderr || '' })
  );
}

describe('FR-009: SVG text-contrast check', () => {
  it('detects low-contrast text (exit 1, supplemental finding)', async () => {
    const r = await run([path.join(FIXTURES, 'contrast-bad.svg'), '--json']);
    assert.equal(r.code, 1, `Expected exit 1, got ${r.code}. stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    const contrastFindings = json.supplemental.filter(f => f.id === 'svg-text-contrast');
    assert.ok(contrastFindings.length > 0, 'Expected at least one svg-text-contrast finding');
    assert.ok(contrastFindings[0].help.includes('insufficient contrast'), `Help text should mention contrast: ${contrastFindings[0].help}`);
  });

  it('passes SVG text with good contrast (no contrast finding)', async () => {
    const r = await run([path.join(FIXTURES, 'contrast-good.svg'), '--json']);
    assert.equal(r.code, 0, `Expected exit 0, got ${r.code}. stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    const contrastFindings = json.supplemental.filter(f => f.id === 'svg-text-contrast');
    assert.equal(contrastFindings.length, 0, 'Expected no contrast violation findings');
  });

  it('emits contrast-unknown note for gradient background (does NOT cause exit 1)', async () => {
    const r = await run([path.join(FIXTURES, 'contrast-gradient.svg'), '--json']);
    // Exit 0 because informational notes alone don't cause exit 1
    assert.equal(r.code, 0, `Expected exit 0 (notes are informational), got ${r.code}. stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    assert.ok(Array.isArray(json.informational), 'Expected informational array in JSON');
    const notes = json.informational.filter(n => n.id === 'svg-text-contrast-unknown');
    assert.ok(notes.length > 0, 'Expected at least one contrast-unknown note');
    assert.ok(notes[0].help.includes('contrast-unknown'), `Note help should say contrast-unknown: ${notes[0].help}`);
    assert.equal(notes[0].impact, 'informational');
  });

  it('emits contrast-unknown note for fill-opacity < 1 (does NOT cause exit 1)', async () => {
    const r = await run([path.join(FIXTURES, 'contrast-opacity.svg'), '--json']);
    assert.equal(r.code, 0, `Expected exit 0 (notes are informational), got ${r.code}. stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    const notes = (json.informational || []).filter(n => n.id === 'svg-text-contrast-unknown');
    assert.ok(notes.length > 0, 'Expected at least one contrast-unknown note for opacity');
    assert.ok(notes[0].help.includes('opacity'), `Note should mention opacity: ${notes[0].help}`);
  });

  it('contrast violation appears in human-readable output', async () => {
    const r = await run([path.join(FIXTURES, 'contrast-bad.svg')]);
    assert.equal(r.code, 1);
    assert.ok(r.stdout.includes('svg-text-contrast'), 'Human output should contain svg-text-contrast');
    assert.ok(r.stdout.includes('insufficient contrast') || r.stdout.includes('contrast ratio'), 'Should mention contrast');
  });
});

describe('FR-009: tspan regression (ancestor text fill != background)', () => {
  it('tspan with good contrast produces ZERO findings (not false 1:1)', async () => {
    const r = await run([path.join(FIXTURES, 'tspan-good.svg'), '--json']);
    assert.equal(r.code, 0, `Expected exit 0, got ${r.code}. stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    const contrastFindings = json.supplemental.filter(f => f.id === 'svg-text-contrast');
    assert.equal(contrastFindings.length, 0, 'Expected no contrast findings for good-contrast tspan');
  });

  it('tspan with low contrast produces a real violation', async () => {
    const r = await run([path.join(FIXTURES, 'tspan-bad.svg'), '--json']);
    assert.equal(r.code, 1, `Expected exit 1, got ${r.code}. stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    const contrastFindings = json.supplemental.filter(f => f.id === 'svg-text-contrast');
    assert.ok(contrastFindings.length > 0, 'Expected contrast violation for low-contrast tspan');
  });

  it('grouped <text> over a light sibling rect is NOT a false 1:1 (real draw.io export)', async () => {
    // draw.io/Mermaid/D3 wrap <text> in <g fill="#000000">; the black is inherited
    // FOREGROUND paint, not a background. The real background is the white sibling
    // <rect>. Background must be hit-tested, not read from ancestor fill.
    const r = await run([path.join(FIXTURES, 'drawio-export-grouped-text.svg'), '--json']);
    const json = JSON.parse(r.stdout);
    const contrastFindings = json.supplemental.filter(f => f.id === 'svg-text-contrast');
    assert.equal(contrastFindings.length, 0,
      `Expected no contrast finding for grouped black text on white rect, got: ${JSON.stringify(contrastFindings)}`);
  });

  it('light text on a dark sibling rect passes (background resolved by hit-test, not body fallback)', async () => {
    const r = await run([path.join(FIXTURES, 'dark-bg-good.svg'), '--json']);
    assert.equal(r.code, 0, `Expected exit 0, got ${r.code}. stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    const contrastFindings = json.supplemental.filter(f => f.id === 'svg-text-contrast');
    assert.equal(contrastFindings.length, 0,
      `Expected no contrast finding for white text on dark rect, got: ${JSON.stringify(contrastFindings)}`);
  });

  it('resolves a pointer-events:none dark background (no false positive vs white page fallback)', async () => {
    // D3/vis.js commonly set pointer-events:none on decoration; elementsFromPoint
    // would skip such a background rect and fall through to the white page,
    // spuriously flagging white-on-white. The check forces shapes hit-testable.
    const r = await run([path.join(FIXTURES, 'dark-bg-pointer-none.svg'), '--json']);
    assert.equal(r.code, 0, `Expected exit 0, got ${r.code}. stderr: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    const contrastFindings = json.supplemental.filter(f => f.id === 'svg-text-contrast');
    assert.equal(contrastFindings.length, 0,
      `Expected no contrast finding for white text on pointer-events:none dark rect, got: ${JSON.stringify(contrastFindings)}`);
  });
});
