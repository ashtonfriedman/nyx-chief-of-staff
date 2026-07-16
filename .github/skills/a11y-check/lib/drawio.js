import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const METACHAR_REGEX = /[`$;&|(){}[\]\\!#~\0\n\r]/;
const RENDERER_TIMEOUT_MS = 60_000;

export function findRenderer() {
  const envCmd = process.env.A11Y_DRAWIO_CMD;
  if (envCmd) {
    console.error(`[a11y-check] Using renderer from A11Y_DRAWIO_CMD: ${envCmd}`);
    if (/\.(?:c?m?js)$/i.test(envCmd)) {
      return { command: process.execPath, prefixArgs: [envCmd] };
    }
    return { command: envCmd, prefixArgs: [] };
  }

  const platform = process.platform;
  let defaultName;
  if (platform === 'darwin') defaultName = 'draw.io';
  else if (platform === 'win32') defaultName = 'draw.io.exe';
  else defaultName = 'drawio';

  return { command: defaultName, prefixArgs: [] };
}

export function validateFilename(filename) {
  const base = path.basename(filename);
  if (METACHAR_REGEX.test(base)) {
    throw Object.assign(
      new Error(`Filename contains shell metacharacters and cannot be passed to the renderer: "${base}"`),
      { exitCode: 2 }
    );
  }
}

export function safeFilename(filePath) {
  const base = path.basename(filePath);
  if (base.startsWith('-')) {
    return `.${path.sep}${filePath}`;
  }
  return filePath;
}

function createWorkDir() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-check-'));
  if (process.platform !== 'win32') {
    fs.chmodSync(workDir, 0o700);
  }
  return workDir;
}

export async function renderDrawio(inputPath) {
  validateFilename(inputPath);

  const { command, prefixArgs } = findRenderer();
  const tmpDir = createWorkDir();
  const outputFile = path.join(tmpDir, 'output.svg');
  const safePath = safeFilename(inputPath);
  const args = [...prefixArgs, '-x', '-f', 'svg', '-p', '0', '-o', outputFile, '--', safePath];
  let keepTmpDir = false;

  try {
    console.error(`[a11y-check] Invoking renderer: ${command} ${args.join(' ')}`);
    await execFileAsync(command, args, {
      timeout: RENDERER_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });

    if (!fs.existsSync(outputFile)) {
      throw new Error('Renderer did not produce output file');
    }

    keepTmpDir = true;
    return { outputFile, tmpDir };
  } catch (e) {
    if (e.killed || e.signal === 'SIGTERM') {
      throw Object.assign(
        new Error(`Renderer timed out after ${RENDERER_TIMEOUT_MS / 1000}s and was killed.`),
        { exitCode: 2 }
      );
    }

    if (e.code === 'ENOENT') {
      throw Object.assign(
        new Error(
          `draw.io renderer not found. Expected command: "${command}"\n` +
          'Install draw.io desktop from https://github.com/jgraph/drawio-desktop/releases\n' +
          'Or set A11Y_DRAWIO_CMD to the path of your renderer executable.'
        ),
        { exitCode: 2 }
      );
    }

    const stderr = (e.stderr || '').slice(0, 2048);
    throw Object.assign(
      new Error(`Renderer failed (exit ${e.code || 'unknown'}):\n${stderr}`),
      { exitCode: 2 }
    );
  } finally {
    if (!keepTmpDir) {
      cleanupTmpDir(tmpDir);
    }
  }
}

export function cleanupTmpDir(tmpDir) {
  if (tmpDir) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
    }
  }
}
