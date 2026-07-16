import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveTarget } from '../lib/resolve.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

describe('resolveTarget', () => {
  it('detects HTML kind', () => {
    const r = resolveTarget(path.join(FIXTURES, 'known-good.html'), FIXTURES);
    assert.equal(r.kind, 'html');
    assert.ok(r.resolvedPath);
  });

  it('detects SVG kind', () => {
    const r = resolveTarget(path.join(FIXTURES, 'known-good.svg'), FIXTURES);
    assert.equal(r.kind, 'svg');
  });

  it('detects .drawio kind', () => {
    const r = resolveTarget(path.join(FIXTURES, 'sample.drawio'), FIXTURES);
    assert.equal(r.kind, 'drawio');
  });

  it('detects URL kind', () => {
    const r = resolveTarget('http://localhost:9999', process.cwd());
    assert.equal(r.kind, 'url');
    assert.equal(r.url, 'http://localhost:9999');
  });

  it('rejects missing file with exitCode 2', () => {
    assert.throws(
      () => resolveTarget('nonexistent.html', process.cwd()),
      (e) => e.exitCode === 2
    );
  });

  it('rejects unsupported extension with exitCode 2', () => {
    const unsupportedPath = path.join(FIXTURES, 'unsupported.png');
    assert.throws(
      () => resolveTarget(unsupportedPath, FIXTURES),
      (e) => e.exitCode === 2 && e.message.includes('Unsupported')
    );
  });

  it('rejects path escaping scan root (SR-001)', () => {
    assert.throws(
      () => resolveTarget(path.join(FIXTURES, '..', '..', 'package.json'), FIXTURES),
      (e) => e.exitCode === 2 && e.message.includes('outside')
    );
  });
});
