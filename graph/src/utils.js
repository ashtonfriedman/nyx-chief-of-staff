import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * Convert a human name to a graph-safe ID slug.
 * "PR Sentinel" → "pr-sentinel", "Cloud Onboarding Initiative" → "cloud-onboarding-initiative"
 */
export function nameToId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** ISO 8601 timestamp */
export function isoNow() {
  return new Date().toISOString();
}

/** SHA-256 hex digest of file content */
export function hashFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Sanitize node content before returning to any agent surface.
 * Applied at EVERY output path (query, get, context, export).
 * Strips: headings, code fences, HTML tags/comments, prompt-injection patterns,
 * trust-boundary delimiter strings.
 * Does NOT alter the database — applied at read time only.
 */
export function sanitizeNodeDescription(text) {
  if (!text) return '';
  return text
    .replace(/^#{1,6}\s+/gm, '')                    // headings
    .replace(/```[\s\S]*?```/g, '[code]')            // code fences
    .replace(/<!--[\s\S]*?-->/g, '')                 // HTML comments (AGENT-002)
    .replace(/<[^>]+>/g, '')                         // HTML tags
    .replace(/ignore\s+previous\s+instructions/gi, '[filtered]')
    .replace(/you\s+are\s+now\s+(?:a|an)\s+/gi, '[filtered]')
    .replace(/^system\s*:/gim, '[filtered]:')
    .replace(/GRAPH MEMORY/gi, '[filtered]')         // delimiter injection (AGENT-002)
    .replace(/END GRAPH MEMORY/gi, '[filtered]')
    .trim();
}

/**
 * Validate a candidate path against the vault root.
 * Uses realpathSync to follow junction points, symlinks, all reparse types.
 * Case-insensitive comparison on Windows. (AGENT-003 fix)
 */
export function validateVaultPath(vaultRoot, candidatePath) {
  const absolute = resolve(candidatePath);
  if (/^\\\\\./.test(absolute)) throw new Error('Device path rejected');
  if (/^[A-Za-z]:[^\\]/.test(candidatePath)) throw new Error('Drive-relative path rejected');
  const real = realpathSync(absolute);
  const vaultReal = realpathSync(vaultRoot);
  if (!real.toLowerCase().startsWith(vaultReal.toLowerCase() + sep)) {
    throw new Error(`Path escapes vault root: ${real}`);
  }
  return real;
}
