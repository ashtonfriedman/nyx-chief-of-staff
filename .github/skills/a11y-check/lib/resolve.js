import fs from 'node:fs';
import path from 'node:path';

const SUPPORTED_EXTENSIONS = ['.html', '.htm', '.svg', '.drawio'];

export function resolveTarget(target, scanRoot) {
  if (!target) throw Object.assign(new Error('No target specified'), { exitCode: 2 });

  if (/^https?:\/\//i.test(target)) {
    return { kind: 'url', url: target, originalInput: target, scanRoot };
  }

  const abs = path.resolve(target);
  let real;
  try {
    real = fs.realpathSync(abs);
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw Object.assign(new Error(`Target not found: ${abs}`), { exitCode: 2 });
    }
    throw Object.assign(new Error(`Cannot resolve target: ${e.message}`), { exitCode: 2 });
  }

  let realRoot;
  try {
    realRoot = fs.realpathSync(path.resolve(scanRoot));
  } catch {
    realRoot = path.resolve(scanRoot);
  }

  if (isFilesystemRoot(realRoot)) {
    console.error('Warning: --root set to filesystem root; file confinement is effectively disabled.');
  }

  const rootPrefix = realRoot.endsWith(path.sep) ? realRoot : realRoot + path.sep;
  if (!real.startsWith(rootPrefix) && real !== realRoot) {
    throw Object.assign(
      new Error(`Target "${real}" is outside the allowed scan root "${realRoot}". Path traversal blocked (SR-001).`),
      { exitCode: 2 }
    );
  }

  const ext = path.extname(real).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw Object.assign(
      new Error(`Unsupported target type '${ext}'. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}, http(s):// URL`),
      { exitCode: 2 }
    );
  }

  let kind;
  if (ext === '.html' || ext === '.htm') kind = 'html';
  else if (ext === '.svg') kind = 'svg';
  else if (ext === '.drawio') kind = 'drawio';

  return { kind, resolvedPath: real, originalInput: target, scanRoot: realRoot };
}

function isFilesystemRoot(p) {
  if (p === '/') return true;
  if (/^[A-Za-z]:\\?$/.test(p)) return true;
  return false;
}
