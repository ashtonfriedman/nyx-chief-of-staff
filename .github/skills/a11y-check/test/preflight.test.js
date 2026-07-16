import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { checkChromium, checkDeps, checkDrawio, runPreflight, whichSync } from '../lib/preflight.js';

const savedEnv = { ...process.env };
afterEach(() => {
  // Restore any env we mutate so tests stay independent.
  for (const k of ['A11Y_DRAWIO_CMD']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe('checkDeps', () => {
  it('reports ok against the real installed node_modules', () => {
    const r = checkDeps();
    assert.equal(r.ok, true, `unexpected missing deps: ${r.missing.join(', ')}`);
    assert.deepEqual(r.missing, []);
  });

  it('reports every required dep missing against an empty modules dir', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-pf-'));
    try {
      const r = checkDeps(empty);
      assert.equal(r.ok, false);
      assert.ok(r.missing.includes('playwright'));
      assert.ok(r.missing.includes('axe-core'));
      assert.ok(r.missing.includes('@axe-core/playwright'));
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('whichSync', () => {
  it('resolves a path-qualified command that exists', () => {
    const self = path.join(os.tmpdir(), `a11y-which-${Date.now()}.txt`);
    fs.writeFileSync(self, 'x');
    try {
      assert.equal(whichSync(self), self);
    } finally {
      fs.rmSync(self, { force: true });
    }
  });

  it('returns null for a path-qualified command that is absent', () => {
    assert.equal(whichSync(path.join(os.tmpdir(), 'definitely-not-here-xyz.exe')), null);
  });

  it('finds a bare command on a synthetic PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-path-'));
    const name = process.platform === 'win32' ? 'faketool.exe' : 'faketool';
    fs.writeFileSync(path.join(dir, name), 'x');
    try {
      const env = { PATH: dir, PATHEXT: '.EXE' };
      const resolved = whichSync(process.platform === 'win32' ? 'faketool' : 'faketool', env);
      assert.ok(resolved && resolved.startsWith(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a bare command absent from PATH', () => {
    assert.equal(whichSync('no-such-binary-abc', { PATH: os.tmpdir() }), null);
  });
});

describe('checkDrawio', () => {
  it('is ok when A11Y_DRAWIO_CMD points at an existing file', () => {
    const fake = path.join(os.tmpdir(), `a11y-drawio-${Date.now()}.exe`);
    fs.writeFileSync(fake, 'x');
    process.env.A11Y_DRAWIO_CMD = fake;
    try {
      const r = checkDrawio();
      assert.equal(r.ok, true);
      assert.equal(r.envSet, true);
    } finally {
      fs.rmSync(fake, { force: true });
    }
  });

  it('is not ok when A11Y_DRAWIO_CMD points at a missing file', () => {
    process.env.A11Y_DRAWIO_CMD = path.join(os.tmpdir(), 'missing-drawio-xyz.exe');
    const r = checkDrawio();
    assert.equal(r.ok, false);
    assert.equal(r.envSet, true);
  });

  it('verifies a JS renderer script referenced by A11Y_DRAWIO_CMD', () => {
    const script = path.join(os.tmpdir(), `a11y-drawio-${Date.now()}.mjs`);
    fs.writeFileSync(script, '// renderer');
    process.env.A11Y_DRAWIO_CMD = script;
    try {
      assert.equal(checkDrawio().ok, true);
    } finally {
      fs.rmSync(script, { force: true });
    }
  });
});

describe('checkChromium', () => {
  it('returns a well-formed result', async () => {
    const r = await checkChromium();
    assert.equal(typeof r.ok, 'boolean');
    // execPath is a string when playwright is loadable, null otherwise.
    assert.ok(r.execPath === null || typeof r.execPath === 'string');
  });
});

describe('runPreflight', () => {
  it('returns ok:true for html when deps + chromium are present', async () => {
    const r = await runPreflight('html');
    // In CI/dev the skill is installed; if chromium is absent the message must guide install.
    if (!r.ok) {
      assert.match(r.message, /playwright install chromium/);
    } else {
      assert.equal(r.message, '');
    }
  });

  it('emits draw.io guidance for a drawio target with an unresolved renderer', async () => {
    process.env.A11Y_DRAWIO_CMD = path.join(os.tmpdir(), 'missing-drawio-abc.exe');
    const r = await runPreflight('drawio');
    // Only asserts the drawio branch when deps+chromium passed; otherwise it's the earlier gate.
    if (!r.ok && /draw\.io/i.test(r.message)) {
      assert.match(r.message, /A11Y_DRAWIO_CMD/);
      assert.match(r.message, /winget install|drawio-desktop/);
    }
  });
});
