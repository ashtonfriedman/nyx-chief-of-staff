#!/usr/bin/env node
import { loadDrawio, loadHtml, loadSvg, loadUrl } from './adapters.js';
import { parseCli, printUsage } from './cli.js';
import { cleanupTmpDir } from './drawio.js';
import { formatHuman, formatJson } from './format.js';
import { runPreflight } from './preflight.js';
import { resolveTarget } from './resolve.js';

const PROCESS_TIMEOUT_MS = 120_000;
const AXE_TIMEOUT_MS = 60_000;

async function main() {
  let opts;
  try {
    opts = parseCli(process.argv.slice(2));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    printUsage();
    process.exit(2);
  }

  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  if (!opts.target) {
    console.error('Error: no target specified.');
    printUsage();
    process.exit(2);
  }

  let resolved;
  try {
    resolved = resolveTarget(opts.target, opts.root);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(e.exitCode || 2);
  }

  // Prerequisite self-check: fail early with copy-paste install guidance
  // instead of a raw stack trace when deps / Chromium / the draw.io CLI are missing.
  const pre = await runPreflight(resolved.kind);
  if (!pre.ok) {
    console.error(pre.message);
    process.exit(2);
  }

  const { createBrowser, runAxeScan } = await import('./engine.js');

  let browser = null;
  let drawioTmpDir = null;
  const safetyTimer = setTimeout(() => {
    console.error('Fatal: process-level safety-net timeout reached (120s). Cleaning up and exiting.');
    if (browser) {
      try {
        browser.close();
      } catch {
      }
    }
    if (drawioTmpDir) cleanupTmpDir(drawioTmpDir);
    process.exitCode = 2;
    process.kill(process.pid, 'SIGTERM');
  }, PROCESS_TIMEOUT_MS);
  safetyTimer.unref();

  try {
    const { browser: b, page } = await createBrowser();
    browser = b;

    switch (resolved.kind) {
      case 'html':
        await loadHtml(page, resolved.resolvedPath, opts.timeout);
        break;
      case 'svg':
        await loadSvg(page, resolved.resolvedPath, opts.timeout);
        break;
      case 'drawio':
        drawioTmpDir = await loadDrawio(page, resolved.resolvedPath, opts.timeout);
        break;
      case 'url':
        await loadUrl(page, resolved.url, opts.timeout, opts.allowRemote);
        break;
      default:
        throw Object.assign(new Error(`Unsupported resolved target kind: ${resolved.kind}`), { exitCode: 2 });
    }

    const { violations, supplemental, informational, passCount } = await runAxeScan(page, opts.tags, AXE_TIMEOUT_MS);
    const result = {
      target: resolved.originalInput,
      kind: resolved.kind,
      tags: opts.tags,
      violations,
      supplemental,
      informational,
      passCount,
    };

    if (opts.json) {
      process.stdout.write(`${formatJson(result, opts.verbose)}\n`);
    } else {
      process.stdout.write(`${formatHuman(result)}\n`);
    }

    const totalFindings = violations.length + supplemental.length;
    process.exitCode = totalFindings === 0 ? 0 : 1;
  } catch (e) {
    console.error(`Error: ${e.message || e}`);
    process.exitCode = e.exitCode || 2;
  } finally {
    clearTimeout(safetyTimer);
    if (drawioTmpDir) cleanupTmpDir(drawioTmpDir);
    if (browser) {
      try {
        await browser.close();
      } catch {
      }
    }
  }
}

main().catch((e) => {
  console.error(`Fatal: ${e.stack || e.message}`);
  process.exitCode = 2;
});
