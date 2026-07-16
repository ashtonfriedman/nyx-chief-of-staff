import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SCAN = path.join(ROOT, 'lib', 'scan.js');
const FIXTURES = path.join(__dirname, 'fixtures');

function run(args, env = {}) {
  return exec(process.execPath, [SCAN, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    timeout: 90_000,
  }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (e) => ({ code: e.code ?? (typeof e.status === 'number' ? e.status : 2), stdout: e.stdout || '', stderr: e.stderr || '' })
  );
}

describe('HTML scanning', () => {
  it('exits 1 on known-bad.html with violations', async () => {
    const r = await run([path.join(FIXTURES, 'known-bad.html')]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /FAIL/);
  });

  it('exits 0 on known-good.html', async () => {
    const r = await run([path.join(FIXTURES, 'known-good.html')]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /PASS/);
  });

  it('emits relative-ref warning for known-bad.html', async () => {
    const r = await run([path.join(FIXTURES, 'known-bad.html')]);
    assert.match(r.stderr, /relative resource reference/i);
  });
});

describe('SVG scanning', () => {
  it('exits 1 on known-bad.svg (missing accessible name)', async () => {
    const r = await run([path.join(FIXTURES, 'known-bad.svg')]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /svg-accessible-name|Supplemental SVG findings/);
  });

  it('exits 0 on known-good.svg', async () => {
    const r = await run([path.join(FIXTURES, 'known-good.svg')]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /PASS/);
  });

  it('exits 0 on decorative SVG (role=presentation)', async () => {
    const r = await run([path.join(FIXTURES, 'svg-decorative.svg')]);
    assert.equal(r.code, 0);
  });

  it('exits 1 on SVG with empty aria-label', async () => {
    const r = await run([path.join(FIXTURES, 'svg-empty-label.svg')]);
    assert.equal(r.code, 1);
  });

  it('does not flag nested SVG without explicit role', async () => {
    const r = await run([path.join(FIXTURES, 'nested-svg.html'), '--json']);
    const json = JSON.parse(r.stdout);
    const nestedFinding = json.supplemental.find((f) =>
      f.id === 'svg-accessible-name' &&
      f.nodes.some((n) => n.target.some((target) => target.includes('svg > svg')))
    );
    assert.equal(nestedFinding, undefined);
  });
});

describe('Exit codes (FR-014)', () => {
  it('exits 2 on missing target', async () => {
    const r = await run([]);
    assert.equal(r.code, 2);
  });

  it('exits 2 on nonexistent file', async () => {
    const r = await run(['nonexistent.html']);
    assert.equal(r.code, 2);
  });

  it('exits 2 on unsupported extension', async () => {
    const r = await run([path.join(FIXTURES, 'unsupported.png')]);
    assert.equal(r.code, 2);
  });
});

describe('JSON output (FR-013)', () => {
  it('produces valid JSON with expected keys', async () => {
    const r = await run([path.join(FIXTURES, 'known-bad.html'), '--json']);
    const json = JSON.parse(r.stdout);
    assert.ok(json.target);
    assert.equal(json.kind, 'html');
    assert.ok(Array.isArray(json.tags));
    assert.ok(Array.isArray(json.violations));
    assert.ok(Array.isArray(json.supplemental));
    assert.equal(typeof json.passes, 'number');
  });

  it('omits node.html by default', async () => {
    const r = await run([path.join(FIXTURES, 'known-bad.html'), '--json']);
    const json = JSON.parse(r.stdout);
    for (const v of json.violations) {
      for (const n of v.nodes) {
        assert.equal(n.html, undefined);
      }
    }
  });

  it('includes node.html with --verbose', async () => {
    const r = await run([path.join(FIXTURES, 'known-bad.html'), '--json', '--verbose']);
    const json = JSON.parse(r.stdout);
    const anyHtml = json.violations.some((v) => v.nodes.some((n) => n.html !== undefined));
    assert.ok(anyHtml);
  });
});

describe('Tag configuration (FR-007)', () => {
  it('uses specified tags', async () => {
    const r = await run([path.join(FIXTURES, 'known-good.html'), '--json', '--tags', 'wcag2a']);
    const json = JSON.parse(r.stdout);
    assert.deepEqual(json.tags, ['wcag2a']);
  });
});

describe('.drawio scanning', () => {
  it('scans .drawio via mock renderer', async () => {
    const mockCmd = path.join(__dirname, 'mock-drawio.js');
    const r = await run([path.join(FIXTURES, 'sample.drawio')], { A11Y_DRAWIO_CMD: mockCmd });
    assert.ok(r.code === 0 || r.code === 1, `Unexpected exit code: ${r.code}\n${r.stderr}`);
  });

  it('exits 2 with install guidance when renderer is missing', async () => {
    const r = await run([path.join(FIXTURES, 'sample.drawio')], { A11Y_DRAWIO_CMD: 'nonexistent-renderer-binary' });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /requires the draw\.io CLI/i);
    assert.match(r.stderr, /winget install|drawio-desktop|A11Y_DRAWIO_CMD/i);
  });

  it('exits 2 when renderer fails', async () => {
    const mockCmd = path.join(__dirname, 'mock-drawio.js');
    const r = await run([path.join(FIXTURES, 'sample.drawio')], {
      A11Y_DRAWIO_CMD: mockCmd,
      MOCK_DRAWIO_FAIL: '1',
    });
    assert.equal(r.code, 2);
  });
});

describe('Security: SR-001 scan-root confinement', () => {
  it('rejects path traversal escaping scan root', async () => {
    const escapingPath = path.join(FIXTURES, '..', '..', 'package.json');
    const r = await run([escapingPath, '--root', FIXTURES]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /outside|traversal/i);
  });
});

describe('Security: SR-004 filename validation', () => {
  it('rejects filenames with shell metacharacters', async () => {
    const badPath = path.join(FIXTURES, 'bad;name.drawio');
    const r = await run([badPath]);
    assert.equal(r.code, 2);
  });
});
