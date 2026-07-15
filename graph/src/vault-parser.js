// vault-parser.js — indexes an IDEA-method markdown vault into the knowledge graph
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { NodeType, RelationshipType } from './types.js';
import { nameToId, isoNow, hashFile, validateVaultPath } from './utils.js';

// ── Constants ──────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  'node_modules', 'Archive', 'inbox', '.github', '.working-memory', 'graph',
]);

const STRUCTURAL_TYPES = new Set([
  NodeType.Domain, NodeType.Initiative, NodeType.ExpertiseArea, NodeType.Person,
]);

const SALIENCE = {
  pinned:     1.0,
  domain:     0.8,
  initiative: 0.8,
  person:     0.7,
  decision:   0.7,
  expertise:  0.6,
  concept:    0.5,
  pattern:    0.5,
  nextAction: 0.4,
};

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const HEADING_RE  = /^(#{1,6})\s+(.+)$/;

// ── Helpers ────────────────────────────────────────────────────────────

/** Normalize a filesystem path to forward-slash vault-relative form. */
function vaultRelative(vaultPath, absPath) {
  return relative(vaultPath, absPath).replace(/\\/g, '/');
}

/** Check if a directory entry name should be skipped. */
function shouldSkip(name) {
  return name.startsWith('.') || SKIP_DIRS.has(name);
}

/** Recursively collect markdown files, respecting skip rules. */
function collectMarkdownFiles(dir, vaultPath) {
  const files = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }

  for (const entry of entries) {
    if (shouldSkip(entry)) continue;
    const abs = join(dir, entry);
    let st;
    try { st = statSync(abs); } catch { continue; }

    if (st.isDirectory()) {
      files.push(...collectMarkdownFiles(abs, vaultPath));
    } else if (st.isFile() && entry.endsWith('.md')) {
      files.push(abs);
    }
  }
  return files;
}

/** Extract the first segment of a vault-relative path. */
function topDir(relPath) {
  const idx = relPath.indexOf('/');
  return idx === -1 ? null : relPath.slice(0, idx);
}

/**
 * Parse markdown into sections keyed by heading text.
 * Returns array of { level, title, body } where body is the text
 * between this heading and the next heading of same or higher level.
 */
function parseSections(content) {
  const lines = content.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      if (current) sections.push(current);
      current = { level: m[1].length, title: m[2].trim(), bodyLines: [] };
    } else if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) sections.push(current);

  return sections.map(s => ({
    level: s.level,
    title: s.title,
    body: s.bodyLines.join('\n').trim(),
  }));
}

/**
 * Extract decision sections from parsed sections.
 * Matches headings containing "Decision" or "Decisions" (case-insensitive)
 * at heading level 3.
 */
function extractDecisions(sections) {
  const decisions = [];
  for (const sec of sections) {
    if (sec.level === 3 && /decisions?/i.test(sec.title)) {
      decisions.push({ title: sec.title, body: sec.body });
    }
  }
  return decisions;
}

/** Extract all wikilink targets from text. */
function extractWikilinks(text) {
  const links = new Set();
  let m;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    links.add(m[1].trim());
  }
  return links;
}

/**
 * Derive the containing structural node ID from a vault-relative file path.
 * Returns { id, type } or null if no structural container can be inferred.
 */
function inferContainer(relPath) {
  const parts = relPath.split('/');

  // domains/people/<category>/<slug>/<file>.md → person-<slug>   (5+ segments)
  // domains/people/<slug>/<file>.md            → person-<slug>   (4+ segments)
  // A bare file directly under people/ (e.g. README.md, 3 segments) or directly
  // under a category folder (4 segments) is NOT a person note — fall through to null
  // so we never attach edges to a person node that was never registered.
  if (parts[0] === 'domains' && parts[1] === 'people') {
    const PEOPLE_CATEGORIES = new Set(['directs', 'peers', 'hierarchy']);
    if (parts.length >= 5 && PEOPLE_CATEGORIES.has(parts[2])) {
      return { id: `person-${parts[3]}`, type: NodeType.Person };
    }
    // Only treat as person folder if it's NOT a known organizational folder
    const SKIP_FOLDERS = new Set(['archive', '_templates', 'node_modules', '.git']);
    if (parts.length >= 4 && !PEOPLE_CATEGORIES.has(parts[2]) && !SKIP_FOLDERS.has(parts[2].toLowerCase())) {
      return { id: `person-${parts[2]}`, type: NodeType.Person };
    }
    return null;
  }

  // domains/<slug>/file.md → domain-<slug> (need 3+ segments: topdir/folder/file)
  if (parts[0] === 'domains' && parts.length >= 3) {
    return { id: `domain-${parts[1]}`, type: NodeType.Domain };
  }

  // initiatives/<slug>/file.md → initiative-<slug>
  if (parts[0] === 'initiatives' && parts.length >= 3) {
    return { id: `initiative-${parts[1]}`, type: NodeType.Initiative };
  }

  // expertise/<slug>/file.md → expertise-<slug>
  if (parts[0] === 'expertise' && parts.length >= 3) {
    return { id: `expertise-${parts[1]}`, type: NodeType.ExpertiseArea };
  }

  return null;
}

/**
 * Derive a human-friendly name from a slug (e.g. "jane-doe" → "Jane Doe").
 */
function slugToName(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Extract the first meaningful paragraph of content (skip headings, frontmatter, empty lines). */
function extractFirstParagraph(content) {
  const lines = content.split(/\r?\n/);
  let inFrontmatter = false;
  const paraLines = [];

  for (const line of lines) {
    if (line.trim() === '---' && paraLines.length === 0) {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;
    if (/^#{1,6}\s/.test(line)) continue; // skip headings
    if (line.trim() === '') {
      if (paraLines.length > 0) break; // end of first paragraph
      continue;
    }
    paraLines.push(line.trim());
  }

  const text = paraLines.join(' ').trim();
  return text.length > 10 ? text.slice(0, 300) : '';
}

// ── Main entry point ───────────────────────────────────────────────────

/**
 * Index an IDEA-method vault into the knowledge graph.
 *
 * @param {import('./graph.js').KnowledgeGraph} graph
 * @param {string} vaultPath — absolute path to vault root
 * @param {{ force?: boolean, singleFile?: string }} opts
 * @returns {IndexResult}
 */
export function indexVault(graph, vaultPath, opts = {}) {
  const t0 = performance.now();
  const stats = {
    filesScanned: 0,
    filesSkipped: 0,
    filesIndexed: 0,
    nodesAdded: 0,
    nodesReinforced: 0,
    edgesAdded: 0,
    decayedNodes: 0,
    durationMs: 0,
    errors: [],
  };

  function track(result) {
    if (result === 'added') stats.nodesAdded++;
    else if (result === 'reinforced') stats.nodesReinforced++;
  }

  function trackEdge(result) {
    if (result === 'added') stats.edgesAdded++;
  }

  // ── Phase 1: Hash Check ────────────────────────────────────────────

  let allFiles;
  if (opts.singleFile) {
    const abs = join(vaultPath, opts.singleFile.replace(/\//g, '\\'));
    allFiles = [abs];
  } else {
    allFiles = collectMarkdownFiles(vaultPath, vaultPath);
  }

  const changedFiles = [];  // { abs, rel, hash, content }
  const unchangedFiles = [];

  for (const abs of allFiles) {
    stats.filesScanned++;
    const rel = vaultRelative(vaultPath, abs);

    try {
      validateVaultPath(vaultPath, abs);
    } catch (e) {
      stats.errors.push(`Validation failed for ${rel}: ${e.message}`);
      continue;
    }

    let hash;
    try {
      hash = hashFile(abs);
    } catch (e) {
      stats.errors.push(`Hash failed for ${rel}: ${e.message}`);
      continue;
    }

    const existingHash = graph.getFileHash(rel);
    if (!opts.force && existingHash === hash) {
      stats.filesSkipped++;
      unchangedFiles.push({ abs, rel, hash });
    } else {
      let content;
      try {
        content = readFileSync(abs, 'utf-8');
      } catch (e) {
        stats.errors.push(`Read failed for ${rel}: ${e.message}`);
        continue;
      }
      changedFiles.push({ abs, rel, hash, content });
    }
  }

  // ── Phase 2: Delete Stale Content ──────────────────────────────────
  // Graph handles this via upsert semantics. We only re-parse changed files,
  // so content nodes from previous parses that are no longer produced
  // will be handled by the graph's own stale-content cleanup.
  // For content nodes sourced from changed files, the graph.setFileRecord
  // call at the end with updated counts signals which files were re-indexed.
  // Note: structural nodes are always re-upserted in Phase 3.

  // ── Phase 3: Structural Scan ───────────────────────────────────────
  // Always runs regardless of file changes — builds structural nodes from folders.

  const personNodes = new Map(); // id → { slug, name }

  if (!opts.singleFile) {
    // Scan domains/
    scanStructuralDir(join(vaultPath, 'domains'), 'domains');
    // Scan initiatives/
    scanStructuralDir(join(vaultPath, 'initiatives'), 'initiatives');
    // Scan expertise/
    scanStructuralDir(join(vaultPath, 'expertise'), 'expertise');
    // Root special files
    scanRootFiles();
  } else {
    // For single-file mode, only create structural node if relevant
    const rel = opts.singleFile.replace(/\\/g, '/');
    const container = inferContainer(rel);
    if (container) {
      const slug = container.id.split('-').slice(1).join('-');
      const name = slugToName(slug);
      track(graph.upsertNode({
        id: container.id,
        type: container.type,
        name,
        salience: SALIENCE[container.type] ?? 0.5,
      }));
    }
  }

  function scanStructuralDir(baseDir, category) {
    let entries;
    try { entries = readdirSync(baseDir); } catch { return; }

    for (const entry of entries) {
      if (shouldSkip(entry)) continue;
      const abs = join(baseDir, entry);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (!st.isDirectory()) continue;

      if (category === 'domains') {
        if (entry === 'people') {
          scanPeopleDir(abs);
        } else {
          const id = `domain-${entry}`;
          const name = slugToName(entry);
          track(graph.upsertNode({
            id,
            type: NodeType.Domain,
            name,
            salience: SALIENCE.domain,
            source_file: vaultRelative(vaultPath, abs),
          }));
        }
      } else if (category === 'initiatives') {
        const id = `initiative-${entry}`;
        const name = slugToName(entry);
        track(graph.upsertNode({
          id,
          type: NodeType.Initiative,
          name,
          salience: SALIENCE.initiative,
          source_file: vaultRelative(vaultPath, abs),
        }));
      } else if (category === 'expertise') {
        const id = `expertise-${entry}`;
        const name = slugToName(entry);
        track(graph.upsertNode({
          id,
          type: NodeType.ExpertiseArea,
          name,
          salience: SALIENCE.expertise,
          source_file: vaultRelative(vaultPath, abs),
        }));
      }
    }
  }

  function scanPeopleDir(peopleDir) {
    const PEOPLE_CATEGORIES = new Set(['directs', 'peers', 'hierarchy']);
    let entries;
    try { entries = readdirSync(peopleDir); } catch { return; }

    for (const entry of entries) {
      if (shouldSkip(entry)) continue;
      const abs = join(peopleDir, entry);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (!st.isDirectory()) continue;

      if (PEOPLE_CATEGORIES.has(entry)) {
        // Category folder — recurse into it for person folders
        let subEntries;
        try { subEntries = readdirSync(abs); } catch { continue; }
        for (const sub of subEntries) {
          if (shouldSkip(sub)) continue;
          const subAbs = join(abs, sub);
          let subSt;
          try { subSt = statSync(subAbs); } catch { continue; }
          if (subSt.isDirectory()) {
            registerPerson(sub, subAbs, entry);
          }
        }
      } else {
        // Direct person folder under people/ — skip organizational folders
        const SKIP_FOLDERS = new Set(['archive', '_templates', 'node_modules', '.git']);
        if (!SKIP_FOLDERS.has(entry.toLowerCase())) {
          registerPerson(entry, abs, null);
        }
      }
    }
  }

  function registerPerson(slug, absDir, category) {
    const id = `person-${slug}`;
    const name = slugToName(slug);
    track(graph.upsertNode({
      id,
      type: NodeType.Person,
      name,
      salience: SALIENCE.person,
      source_file: vaultRelative(vaultPath, absDir),
    }));
    if (category) {
      graph.setProperty(id, 'category', category);
    }
    personNodes.set(id, { slug, name });
  }

  function scanRootFiles() {
    let entries;
    try { entries = readdirSync(vaultPath); } catch { return; }

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      if (entry === 'SOUL.md') {
        track(graph.upsertNode({
          id: 'rule-soul',
          type: NodeType.Rule,
          name: 'SOUL',
          description: 'Core personality, voice, values, and mission',
          salience: SALIENCE.pinned,
          pinned: true,
          source_file: 'SOUL.md',
        }));
      }
    }
  }

  // ── Phase 4: Content Parse (changed files only) ────────────────────

  // Build person name lookup for mention detection
  const personNameIndex = buildPersonNameIndex(personNodes);

  for (const file of changedFiles) {
    try {
      parseFileContent(file);
      stats.filesIndexed++;
    } catch (e) {
      stats.errors.push(`Parse error in ${file.rel}: ${e.message}`);
    }
  }

  function parseFileContent(file) {
    const { rel, content, hash } = file;
    const sections = parseSections(content);
    let nodeCount = 0;
    let edgeCount = 0;

    // 4pre: Populate structural node descriptions from their main file
    const container = inferContainer(rel);
    const fileName = basename(rel, '.md');
    const dirName = dirname(rel).split('/').pop();
    if (container && (fileName === 'index' || fileName === 'README' || fileName === dirName)) {
      const desc = extractFirstParagraph(content);
      if (desc) {
        graph.updateNode(container.id, { description: desc });
      }
    }

    // 4a: Decision nodes
    const decisions = extractDecisions(sections);
    for (let i = 0; i < decisions.length; i++) {
      const dec = decisions[i];
      const decSlug = nameToId(dec.title);
      const id = `decision-${decSlug}-${nameToId(basename(rel, '.md'))}`;
      const result = graph.upsertNode({
        id,
        type: NodeType.Decision,
        name: dec.title,
        description: dec.body.slice(0, 500),
        salience: SALIENCE.decision,
        source_file: rel,
        source_section: dec.title,
      });
      track(result);
      nodeCount++;
    }

    // 4b: Wikilinks → WikilinksTo edges
    const wikilinks = extractWikilinks(content);
    // We need a source node for edges. Use the file's container or create a concept for the file.
    const fileNodeId = resolveFileNodeId(rel);

    for (const linkTarget of wikilinks) {
      const targetId = resolveWikilinkTarget(linkTarget);
      const result = graph.upsertEdge({
        sourceId: fileNodeId,
        targetId,
        relationship: RelationshipType.WikilinksTo,
        weight: 0.5,
        description: `Links to [[${linkTarget}]]`,
      });
      trackEdge(result);
      edgeCount++;
    }

    // 4c: Person mentions → MentionedIn edges
    const mentionedPersonIds = detectPersonMentions(content, personNameIndex);
    for (const personId of mentionedPersonIds) {
      const result = graph.upsertEdge({
        sourceId: personId,
        targetId: fileNodeId,
        relationship: RelationshipType.MentionedIn,
        weight: 0.3,
        description: `Mentioned in ${rel}`,
      });
      trackEdge(result);
      edgeCount++;
    }

    // ── Phase 5: Edge Inference (per file) ─────────────────────────

    // Infer ContainedIn for each content node sourced from this file
    const fileContainer = inferContainer(rel);
    if (fileContainer) {
      // The file's own concept node
      if (fileNodeId !== fileContainer.id) {
        const result = graph.upsertEdge({
          sourceId: fileNodeId,
          targetId: fileContainer.id,
          relationship: RelationshipType.ContainedIn,
          weight: 1.0,
        });
        trackEdge(result);
        edgeCount++;
      }

      // Decision nodes from this file
      for (let i = 0; i < decisions.length; i++) {
        const dec = decisions[i];
        const decSlug = nameToId(dec.title);
        const decId = `decision-${decSlug}-${nameToId(basename(rel, '.md'))}`;
        const result = graph.upsertEdge({
          sourceId: decId,
          targetId: fileContainer.id,
          relationship: RelationshipType.ContainedIn,
          weight: 1.0,
        });
        trackEdge(result);
        edgeCount++;
      }
    }

    // Update indexed_files record
    graph.setFileRecord(rel, hash, nodeCount, edgeCount);
  }

  /**
   * Resolve a file path to its representative node ID.
   * Structural files map to their structural node; other files become Concept nodes.
   */
  function resolveFileNodeId(rel) {
    const container = inferContainer(rel);
    const fileName = basename(rel, '.md');
    const dirName = dirname(rel).split('/').pop();

    // If the file is the "index" or eponymous file of its structural container,
    // use the container's ID directly (e.g. domains/egs/egs.md → domain-egs)
    if (container && (fileName === 'index' || fileName === 'README' || fileName === dirName)) {
      return container.id;
    }

    // Otherwise create a Concept node for this file
    const id = `concept-${nameToId(rel.replace(/\.md$/, '').replace(/\//g, '-'))}`;
    track(graph.upsertNode({
      id,
      type: NodeType.Concept,
      name: slugToName(fileName),
      salience: SALIENCE.concept,
      source_file: rel,
    }));
    return id;
  }

  /**
   * Resolve a wikilink target to a node ID.
   * Tries to match existing structural nodes first, then creates a stub Concept.
   */
  function resolveWikilinkTarget(linkText) {
    const slug = nameToId(linkText);

    // Try known structural node patterns
    const candidates = [
      `person-${slug}`,
      `initiative-${slug}`,
      `domain-${slug}`,
      `expertise-${slug}`,
    ];

    for (const cid of candidates) {
      if (graph.getNode(cid)) return cid;
    }

    // Create stub concept node
    const id = `concept-${slug}`;
    if (!graph.getNode(id)) {
      track(graph.upsertNode({
        id,
        type: NodeType.Concept,
        name: linkText,
        salience: SALIENCE.concept,
      }));
    }
    return id;
  }

  stats.durationMs = Math.round(performance.now() - t0);
  return stats;
}

// ── Person mention detection ───────────────────────────────────────────

/**
 * Build an index for fast person name matching.
 * Uses first names (conservative approach — only match first name as a whole word).
 * Returns Map<lowercased-first-name, personId[]>.
 */
function buildPersonNameIndex(personNodes) {
  const index = new Map();
  for (const [id, { name }] of personNodes) {
    const parts = name.split(/\s+/);
    if (parts.length === 0) continue;

    // Index by first name — conservative strategy
    const firstName = parts[0].toLowerCase();
    // Skip very short or common names that cause false positives
    if (firstName.length < 3) continue;

    if (!index.has(firstName)) index.set(firstName, []);
    index.get(firstName).push({ id, fullName: name });
  }
  return index;
}

/**
 * Detect person mentions in text using the person name index.
 * Returns a Set of person node IDs that are mentioned.
 * Conservative: requires whole-word match of first name and preferably full name.
 */
function detectPersonMentions(content, personNameIndex) {
  const mentioned = new Set();
  if (personNameIndex.size === 0) return mentioned;

  // Build a combined regex for all first names (whole word, case-insensitive)
  const names = [...personNameIndex.keys()];
  const pattern = new RegExp(`\\b(${names.map(escapeRegExp).join('|')})\\b`, 'gi');

  let m;
  while ((m = pattern.exec(content)) !== null) {
    const matchedFirst = m[1].toLowerCase();
    const candidates = personNameIndex.get(matchedFirst);
    if (!candidates) continue;

    for (const { id, fullName } of candidates) {
      // Prefer full name match — check if full name appears near the first name match
      const fullNameLower = fullName.toLowerCase();
      const contextStart = Math.max(0, m.index - 5);
      const contextEnd = Math.min(content.length, m.index + fullName.length + 5);
      const context = content.slice(contextStart, contextEnd).toLowerCase();

      if (context.includes(fullNameLower)) {
        mentioned.add(id);
      } else if (candidates.length === 1) {
        // Unique first name — safe to accept first-name-only match
        mentioned.add(id);
      }
      // If multiple people share a first name, require full name match
    }
  }

  return mentioned;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
