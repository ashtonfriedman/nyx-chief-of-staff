import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cleanupTmpDir, renderDrawio } from '../lib/drawio.js';
import { isBlockedIp, validateRedirect } from '../lib/ssrf.js';

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

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe('Security hardening', () => {
  it('blocks 0.0.0.0 as an unspecified address', () => {
    assert.deepEqual(isBlockedIp('0.0.0.0'), { blocked: true, reason: 'unspecified' });
  });

  it('keeps drawio temp output under os.tmpdir without touching the source directory', async () => {
    const fixturePath = path.join(FIXTURES, 'sample.drawio');
    const mockCmd = path.join(__dirname, 'mock-drawio.js');
    const legacyWorkDir = path.join(FIXTURES, '.a11y-check-work');
    const priorCmd = process.env.A11Y_DRAWIO_CMD;
    let tmpDir;

    process.env.A11Y_DRAWIO_CMD = mockCmd;
    try {
      const result = await renderDrawio(fixturePath);
      tmpDir = result.tmpDir;

      assert.ok(tmpDir.startsWith(os.tmpdir()), `Expected tmpDir under ${os.tmpdir()}, got ${tmpDir}`);
      assert.ok(fs.existsSync(result.outputFile), 'Expected rendered SVG output to exist');
      assert.equal(fs.existsSync(legacyWorkDir), false, 'Legacy in-repo work directory should not be created');
    } finally {
      cleanupTmpDir(tmpDir);
      if (priorCmd === undefined) delete process.env.A11Y_DRAWIO_CMD;
      else process.env.A11Y_DRAWIO_CMD = priorCmd;
    }
  });

  it('fails closed when redirect DNS resolution fails', async () => {
    const originalResolve4 = dns.promises.resolve4;
    const originalResolve6 = dns.promises.resolve6;

    dns.promises.resolve4 = async () => {
      throw Object.assign(new Error('resolve4 failed'), { code: 'ENOTFOUND' });
    };
    dns.promises.resolve6 = async () => {
      throw Object.assign(new Error('resolve6 failed'), { code: 'ENOTFOUND' });
    };

    try {
      await assert.rejects(
        validateRedirect('http://unresolvable.example.invalid/'),
        (e) => e.exitCode === 2 && /Cannot resolve hostname "unresolvable\.example\.invalid"/.test(e.message)
      );
    } finally {
      dns.promises.resolve4 = originalResolve4;
      dns.promises.resolve6 = originalResolve6;
    }
  });

  it('rejects invalid redirect URLs', async () => {
    await assert.rejects(
      validateRedirect('not a url'),
      (e) => e.exitCode === 2 && /Invalid redirect URL/.test(e.message)
    );
  });

  it('blocks loopback redirects before the redirected target is loaded', async () => {
    let blockedHits = 0;
    const blockedServer = http.createServer((req, res) => {
      blockedHits += 1;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body>blocked target</body></html>');
    });
    const blockedPort = await listen(blockedServer);

    const redirectServer = http.createServer((req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${blockedPort}/blocked` });
      res.end();
    });
    const redirectPort = await listen(redirectServer);

    try {
      const r = await run([`http://localhost:${redirectPort}/start`]);
      assert.equal(r.code, 2);
      assert.match(r.stderr, /Redirect to blocked address|SSRF policy|loopback/i);
      assert.equal(blockedHits, 0, 'Redirect target should be blocked before Chromium loads it');
    } finally {
      await closeServer(redirectServer);
      await closeServer(blockedServer);
    }
  });
});
