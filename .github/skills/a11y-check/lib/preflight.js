import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRenderer } from './drawio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULES_DIR = path.join(__dirname, '..', 'node_modules');
const SKILL_DIR = path.join(__dirname, '..');

const REQUIRED_DEPS = ['playwright', '@axe-core/playwright', 'axe-core'];

// --- individual checks (exported for testing) -------------------------------

export function checkDeps(modulesDir = MODULES_DIR) {
  const missing = REQUIRED_DEPS.filter((dep) => {
    const parts = dep.split('/');
    return !fs.existsSync(path.join(modulesDir, ...parts));
  });
  return { ok: missing.length === 0, missing };
}

export async function checkChromium() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return { ok: false, execPath: null };
  }
  let execPath = null;
  try {
    execPath = chromium.executablePath();
  } catch {
    execPath = null;
  }
  const ok = Boolean(execPath) && fs.existsSync(execPath);
  return { ok, execPath };
}

// Resolve a bare command against PATH (+ PATHEXT on Windows), or verify a
// path-qualified command exists on disk. Node built-ins only.
export function whichSync(cmd, env = process.env) {
  if (!cmd) return null;
  if (cmd.includes(path.sep) || cmd.includes('/')) {
    return fs.existsSync(cmd) ? cmd : null;
  }
  const dirs = (env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32'
    ? ['', ...(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Is the draw.io renderer resolvable? Mirrors drawio.js findRenderer() intent.
export function checkDrawio(env = process.env) {
  const { command, prefixArgs } = findRenderer();
  // A11Y_DRAWIO_CMD pointing at a JS entry: node runs it, verify the script file.
  const scriptArg = prefixArgs.find((a) => /\.(?:c?m?js)$/i.test(a));
  if (scriptArg) {
    return { ok: fs.existsSync(scriptArg), resolved: scriptArg, envSet: true };
  }
  const resolved = whichSync(command, env);
  return { ok: Boolean(resolved), resolved, envSet: Boolean(env.A11Y_DRAWIO_CMD) };
}

// --- guidance messages ------------------------------------------------------

function depsMessage(missing) {
  return [
    '[a11y-check] Missing npm dependencies — the skill has not been installed yet.',
    `             Not found: ${missing.join(', ')}`,
    '',
    '  Run this once, inside the skill folder:',
    `    cd "${SKILL_DIR}"`,
    '    npm install',
    '    npx playwright install chromium',
  ].join('\n');
}

function chromiumMessage(execPath) {
  return [
    "[a11y-check] Playwright's Chromium browser is not installed.",
    '',
    '  Install it once (downloads ~150 MB):',
    '    npx playwright install chromium',
    execPath ? `\n  (Looked for the browser at: ${execPath})` : '',
  ].filter(Boolean).join('\n');
}

function drawioMessage(check) {
  const lines = [
    '[a11y-check] Scanning a .drawio file requires the draw.io CLI, which was not found.',
  ];
  if (check.envSet) {
    lines.push(
      `             A11Y_DRAWIO_CMD is set but did not resolve${check.resolved ? ` (${check.resolved})` : ''}.`
    );
  }
  lines.push(
    '',
    '  Option A — install draw.io desktop (provides the CLI):',
    '    https://github.com/jgraph/drawio-desktop/releases',
    '    Windows:  winget install --id JGraph.Draw',
    '    macOS:    brew install --cask drawio',
    '',
    '  Option B — point the skill at an existing renderer:',
    '    PowerShell:  $env:A11Y_DRAWIO_CMD = "<path to draw.io executable>"',
    '    bash/zsh:    export A11Y_DRAWIO_CMD="<path to draw.io executable>"',
    '',
    '  HTML, SVG, and localhost-URL targets do NOT need this.',
  );
  return lines.join('\n');
}

// --- orchestrator -----------------------------------------------------------

// Returns { ok, message }. On ok=false the caller prints message and exits 2.
export async function runPreflight(kind) {
  const deps = checkDeps();
  if (!deps.ok) {
    return { ok: false, message: depsMessage(deps.missing) };
  }

  const chromium = await checkChromium();
  if (!chromium.ok) {
    return { ok: false, message: chromiumMessage(chromium.execPath) };
  }

  if (kind === 'drawio') {
    const drawio = checkDrawio();
    if (!drawio.ok) {
      return { ok: false, message: drawioMessage(drawio) };
    }
  }

  return { ok: true, message: '' };
}
