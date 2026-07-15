// manifest.js — generates mind-index.md from filesystem scan
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';

// ── Section definitions (fixed order) ──────────────────────────────────

const SECTIONS = [
  'Identity',
  'Working Memory',
  'Skills',
  'Infrastructure',
  'Domains',
  'Expertise',
  'Initiatives',
];

// ── Skip rules ─────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', 'Archive', 'inbox', '.git', '__pycache__',
]);

const SKIP_EXTENSIONS = new Set(['.db', '.jsonl']);

const SKIP_ROOT_FILES = new Set([
  'package.json', 'package-lock.json', '.gitignore', 'README.md',
]);

function shouldSkipFile(name, relPath) {
  const ext = extname(name);
  if (SKIP_EXTENSIONS.has(ext)) return true;
  if (ext === '.json' && name !== 'agent-maintenance-state.json') return true;
  // Skip root-level files by exact name
  if (SKIP_ROOT_FILES.has(relPath)) return true;
  return false;
}

// ── Purpose extraction ─────────────────────────────────────────────────

function extractPurpose(absPath) {
  let content;
  try { content = readFileSync(absPath, 'utf-8'); } catch { return slugToTitle(absPath); }

  // Try YAML frontmatter description
  if (content.startsWith('---')) {
    const endIdx = content.indexOf('---', 3);
    if (endIdx !== -1) {
      const frontmatter = content.slice(3, endIdx);
      const match = frontmatter.match(/^description:\s*(.+)$/m);
      if (match) return truncate(match[1].trim().replace(/^["']|["']$/g, ''), 120);
    }
  }

  // Try first markdown heading
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') && !trimmed.startsWith('#!')) {
      const text = trimmed.replace(/^#+\s*/, '').trim();
      if (text) return truncate(text, 120);
    }
    // Skip frontmatter lines and blank lines when looking for heading
    if (trimmed === '---' || trimmed === '') continue;
    // If we hit non-heading content, stop looking
    if (!trimmed.startsWith('#') && !trimmed.startsWith('---')) break;
  }

  // Fallback: filename slug to title case
  return slugToTitle(absPath);
}

function slugToTitle(absPath) {
  const name = basename(absPath, extname(absPath));
  return name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

// ── Directory walkers ──────────────────────────────────────────────────

function listDir(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

/** Recursively collect files matching a filter. */
function collectFiles(dir, filter) {
  const results = [];
  const entries = listDir(dir);
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (isDir(abs)) {
      results.push(...collectFiles(abs, filter));
    } else if (isFile(abs) && filter(entry, abs)) {
      results.push(abs);
    }
  }
  return results;
}

/** Normalize a path to vault-relative with forward slashes. */
function toRelPath(vault, absPath) {
  return relative(vault, absPath).replace(/\\/g, '/');
}

// ── Section scanners ───────────────────────────────────────────────────

function scanIdentity(vault) {
  const entries = [];

  // SOUL.md at root
  const soul = join(vault, 'SOUL.md');
  if (isFile(soul)) entries.push(soul);

  // .github/agents/*.agent.md
  const agentsDir = join(vault, '.github', 'agents');
  for (const name of listDir(agentsDir)) {
    if (name.endsWith('.agent.md')) {
      const abs = join(agentsDir, name);
      if (isFile(abs)) entries.push(abs);
    }
  }

  return entries;
}

function scanWorkingMemory(vault) {
  const allowed = new Set(['memory.md', 'rules.md', 'log.md', 'instance.md']);
  const wmDir = join(vault, '.working-memory');
  const entries = [];
  for (const name of listDir(wmDir)) {
    if (allowed.has(name)) {
      const abs = join(wmDir, name);
      if (isFile(abs)) entries.push(abs);
    }
  }
  return entries;
}

function scanSkills(vault) {
  const skillsDir = join(vault, '.github', 'skills');
  const entries = [];
  for (const skillName of listDir(skillsDir)) {
    const skillFile = join(skillsDir, skillName, 'SKILL.md');
    if (isFile(skillFile)) entries.push(skillFile);
  }
  return entries;
}

function scanInfrastructure(vault) {
  const entries = [];
  const scriptExts = new Set(['.ps1', '.mjs', '.js']);

  // .github/scripts/ — .ps1, .mjs, .js files (top-level only, plus data/agent-maintenance-state.json)
  const scriptsDir = join(vault, '.github', 'scripts');
  for (const name of listDir(scriptsDir)) {
    const abs = join(scriptsDir, name);
    if (isFile(abs) && scriptExts.has(extname(name))) {
      entries.push(abs);
    }
  }
  // agent-maintenance-state.json from data subdir
  const stateFile = join(scriptsDir, 'data', 'agent-maintenance-state.json');
  if (isFile(stateFile)) entries.push(stateFile);

  // graph/graph-cli.js
  const cliFile = join(vault, 'graph', 'graph-cli.js');
  if (isFile(cliFile)) entries.push(cliFile);

  // graph/src/*.js
  const graphSrcDir = join(vault, 'graph', 'src');
  for (const name of listDir(graphSrcDir)) {
    if (name.endsWith('.js')) {
      const abs = join(graphSrcDir, name);
      if (isFile(abs)) entries.push(abs);
    }
  }

  return entries;
}

function scanDomains(vault) {
  const dir = join(vault, 'domains');
  return collectFiles(dir, (name) => name.endsWith('.md'));
}

function scanExpertise(vault) {
  const dir = join(vault, 'expertise');
  return collectFiles(dir, (name) => name.endsWith('.md'));
}

function scanInitiatives(vault) {
  const dir = join(vault, 'initiatives');
  return collectFiles(dir, (name) => name.endsWith('.md'));
}

const SCANNERS = {
  'Identity': scanIdentity,
  'Working Memory': scanWorkingMemory,
  'Skills': scanSkills,
  'Infrastructure': scanInfrastructure,
  'Domains': scanDomains,
  'Expertise': scanExpertise,
  'Initiatives': scanInitiatives,
};

// ── Main ───────────────────────────────────────────────────────────────

export function generateManifest(vault) {
  const lines = [
    '# Mind Index',
    '',
    'Auto-generated manifest of all files in this mind. Do not edit manually.',
    'Regenerate: `node graph/graph-cli.js manifest`',
  ];

  for (const section of SECTIONS) {
    const scanner = SCANNERS[section];
    const files = scanner(vault);

    // Build entries with relative paths and purposes
    const entries = files
      .filter(abs => {
        const rel = toRelPath(vault, abs);
        const name = basename(abs);
        return !shouldSkipFile(name, rel);
      })
      .map(abs => {
        const rel = toRelPath(vault, abs);
        const purpose = extractPurpose(abs);
        return { path: rel, purpose };
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    if (entries.length === 0) continue;

    lines.push('');
    lines.push(`## ${section}`);
    lines.push('');
    lines.push('| Path | Purpose |');
    lines.push('|------|---------|');
    for (const e of entries) {
      lines.push(`| \`${e.path}\` | ${e.purpose} |`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
