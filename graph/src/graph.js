import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';
import { isoNow, sanitizeNodeDescription } from './utils.js';

/**
 * SQLite-backed knowledge graph for the agent personal knowledge system.
 * Uses node:sqlite (Node 24+) — zero external dependencies.
 */
export class KnowledgeGraph {
  /** @type {import('node:sqlite').DatabaseSync} */
  #db;

  /**
   * Open (or create) a knowledge graph database.
   * @param {string} dbPath  File path or ':memory:' for in-memory
   */
  constructor(dbPath = ':memory:') {
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec(SCHEMA_SQL);
  }

  /** Close the database connection. */
  close() {
    this.#db.close();
  }

  // ── Node CRUD ────────────────────────────────────────────────

  /**
   * Insert a new node. Throws on duplicate id.
   * @param {object} opts
   * @returns {object} The inserted node row
   */
  addNode({ id, type, name, description = '', salience = 0.5, confidence = 1.0, pinned = 0, source_file = null, source_section = null }) {
    const now = isoNow();
    this.#db.prepare(`
      INSERT INTO nodes (id, type, name, description, salience, confidence, pinned, source_file, source_section, created_at, last_reinforced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, name, description, salience, confidence, pinned ? 1 : 0, source_file, source_section, now, now);
    return this.getNode(id);
  }

  /**
   * Fetch a single node by id, with description sanitized.
   * @param {string} id
   * @returns {object|null}
   */
  getNode(id) {
    const row = this.#db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    if (!row) return null;
    row.description = sanitizeNodeDescription(row.description);
    return row;
  }

  /**
   * Insert-or-reinforce a node.
   * If the node exists: bump salience by 0.05 (capped at 1.0), update description
   * only if new description is longer, refresh last_reinforced.
   * If not: INSERT with defaults.
   * @returns {'added'|'reinforced'}
   */
  upsertNode({ id, type, name, description = '', salience = 0.5, pinned = 0, source_file = null, source_section = null }) {
    const existing = this.#db.prepare('SELECT * FROM nodes WHERE id = ?').get(id);
    if (existing) {
      const newSalience = Math.min(1.0, existing.salience + 0.05);
      const newDesc = (description.length > existing.description.length) ? description : existing.description;
      const now = isoNow();
      this.#db.prepare(`
        UPDATE nodes SET salience = ?, description = ?, last_reinforced = ?,
          pinned = CASE WHEN ? = 1 THEN 1 ELSE pinned END,
          source_file = COALESCE(?, source_file),
          source_section = COALESCE(?, source_section)
        WHERE id = ?
      `).run(newSalience, newDesc, now, pinned ? 1 : 0, source_file, source_section, id);
      return 'reinforced';
    }
    this.addNode({ id, type, name, description, salience, pinned, source_file, source_section });
    return 'added';
  }

  /**
   * Partial update of a node's mutable fields.
   * @param {string} id
   * @param {object} fields  Keys to update (description, salience, confidence, pinned, source_file, source_section)
   * @returns {boolean} true if row was found and updated
   */
  updateNode(id, fields) {
    // Predefined safe column map — never interpolate user-supplied strings into SQL
    const COLUMN_MAP = {
      description: 'description', salience: 'salience', confidence: 'confidence',
      pinned: 'pinned', source_file: 'source_file', source_section: 'source_section',
      name: 'name', type: 'type'
    };
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      const col = COLUMN_MAP[k];
      if (!col) continue;
      sets.push(`${col} = ?`);
      vals.push(k === 'pinned' ? (v ? 1 : 0) : v);
    }
    if (sets.length === 0) return false;
    sets.push('last_reinforced = ?');
    vals.push(isoNow());
    vals.push(id);
    const { changes } = this.#db.prepare(`UPDATE nodes SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    return changes > 0;
  }

  /**
   * Bump a node's salience, capped at 1.0.
   * @param {string} id
   * @param {number} amount  Default 0.1
   * @returns {number|null} New salience, or null if node not found
   */
  reinforceNode(id, amount = 0.1) {
    const node = this.#db.prepare('SELECT salience FROM nodes WHERE id = ?').get(id);
    if (!node) return null;
    const newSalience = Math.min(1.0, node.salience + amount);
    this.#db.prepare('UPDATE nodes SET salience = ?, last_reinforced = ? WHERE id = ?')
      .run(newSalience, isoNow(), id);
    return newSalience;
  }

  /**
   * Delete a node and all its edges/tags/properties (via CASCADE).
   * @param {string} id
   * @returns {boolean}
   */
  deleteNode(id) {
    const { changes } = this.#db.prepare('DELETE FROM nodes WHERE id = ?').run(id);
    return changes > 0;
  }

  /**
   * Find nodes by filter criteria.
   * @param {object} opts
   * @returns {object[]}
   */
  findNodes({ type, tag, minSalience, sourceFile, limit = 50, pinned } = {}) {
    const clauses = [];
    const params = [];

    if (type) { clauses.push('n.type = ?'); params.push(type); }
    if (minSalience != null) { clauses.push('n.salience >= ?'); params.push(minSalience); }
    if (sourceFile) { clauses.push('LOWER(n.source_file) = LOWER(?)'); params.push(sourceFile); }
    if (pinned != null) { clauses.push('n.pinned = ?'); params.push(pinned ? 1 : 0); }

    let sql;
    if (tag) {
      clauses.push('t.tag = ?');
      params.push(tag);
      sql = `SELECT n.* FROM nodes n JOIN node_tags t ON t.node_id = n.id`;
    } else {
      sql = `SELECT n.* FROM nodes n`;
    }

    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY n.salience DESC';
    sql += ' LIMIT ?';
    params.push(limit);

    const rows = this.#db.prepare(sql).all(...params);
    return rows.map(r => { r.description = sanitizeNodeDescription(r.description); return r; });
  }

  /**
   * Full-text search via FTS5, with LIKE fallback on parse errors.
   * @param {string} query
   * @param {number} limit
   * @returns {Array<{node: object, score: number}>}
   */
  searchNodes(query, limit = 10) {
    try {
      const rows = this.#db.prepare(`
        SELECT n.*, -rank AS score
        FROM node_fts f
        JOIN nodes n ON n.rowid = f.rowid
        WHERE node_fts MATCH ?
        ORDER BY -rank
        LIMIT ?
      `).all(query, limit);
      return rows.map(r => {
        const score = r.score;
        delete r.score;
        r.description = sanitizeNodeDescription(r.description);
        return { node: r, score };
      });
    } catch {
      // Fallback to LIKE for queries FTS5 can't parse
      const pattern = `%${query}%`;
      const rows = this.#db.prepare(`
        SELECT *, 1.0 AS score FROM nodes
        WHERE name LIKE ? OR description LIKE ?
        ORDER BY salience DESC
        LIMIT ?
      `).all(pattern, pattern, limit);
      return rows.map(r => {
        const score = r.score;
        delete r.score;
        r.description = sanitizeNodeDescription(r.description);
        return { node: r, score };
      });
    }
  }

  // ── Edge CRUD ────────────────────────────────────────────────

  /**
   * Insert a new edge. Throws on duplicate (source, target, relationship).
   * @param {object} opts
   * @returns {object}
   */
  addEdge({ sourceId, targetId, relationship, weight = 1.0, description = '' }) {
    const now = isoNow();
    this.#db.prepare(`
      INSERT INTO edges (source_id, target_id, relationship, weight, description, created_at, last_reinforced)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sourceId, targetId, relationship, weight, description, now, now);
    return { source_id: sourceId, target_id: targetId, relationship, weight, description: sanitizeNodeDescription(description), created_at: now, last_reinforced: now };
  }

  /**
   * Insert-or-reinforce an edge.
   * If exists: bump weight by 0.1 (cap 10), update last_reinforced, update description if longer.
   * @returns {'added'|'reinforced'}
   */
  upsertEdge({ sourceId, targetId, relationship, weight = 1.0, description = '' }) {
    const existing = this.#db.prepare(
      'SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND relationship = ?'
    ).get(sourceId, targetId, relationship);

    if (existing) {
      const newWeight = Math.min(10.0, existing.weight + 0.1);
      const newDesc = (description.length > existing.description.length) ? description : existing.description;
      this.#db.prepare(`
        UPDATE edges SET weight = ?, description = ?, last_reinforced = ?
        WHERE source_id = ? AND target_id = ? AND relationship = ?
      `).run(newWeight, newDesc, isoNow(), sourceId, targetId, relationship);
      return 'reinforced';
    }

    this.addEdge({ sourceId, targetId, relationship, weight, description });
    return 'added';
  }

  /**
   * Get edges connected to a node.
   * @param {string} nodeId
   * @param {'both'|'outgoing'|'incoming'} direction
   * @param {string} [relationship]  Optional filter
   * @returns {object[]}
   */
  getEdges(nodeId, direction = 'both', relationship) {
    const parts = [];
    const params = [];

    if (direction === 'outgoing' || direction === 'both') {
      let sql = 'SELECT * FROM edges WHERE source_id = ?';
      const p = [nodeId];
      if (relationship) { sql += ' AND relationship = ?'; p.push(relationship); }
      parts.push({ sql, params: p });
    }
    if (direction === 'incoming' || direction === 'both') {
      let sql = 'SELECT * FROM edges WHERE target_id = ?';
      const p = [nodeId];
      if (relationship) { sql += ' AND relationship = ?'; p.push(relationship); }
      parts.push({ sql, params: p });
    }

    const results = [];
    for (const { sql, params: p } of parts) {
      results.push(...this.#db.prepare(sql).all(...p));
    }

    // Sanitize edge descriptions at output boundary (AGENT-001)
    const sanitize = rows => rows.map(e => ({ ...e, description: sanitizeNodeDescription(e.description) }));

    // Deduplicate for 'both' direction (edge could match both sides if self-referencing)
    if (direction === 'both') {
      const seen = new Set();
      return sanitize(results.filter(e => {
        const key = `${e.source_id}|${e.target_id}|${e.relationship}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }));
    }
    return sanitize(results);
  }

  // ── Graph Traversal ──────────────────────────────────────────

  /**
   * BFS from a node, expanding outgoing + incoming edges up to `depth` hops.
   * @param {string} nodeId  Starting node
   * @param {number} depth   Max hops (default 2)
   * @param {number} minSalience  Filter threshold
   * @returns {object[]} Nodes sorted by salience DESC
   */
  getSubgraph(nodeId, depth = 2, minSalience = 0) {
    const visited = new Set();
    let frontier = [nodeId];
    visited.add(nodeId);

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier = [];
      for (const nid of frontier) {
        const edges = this.#db.prepare(
          'SELECT target_id AS neighbor FROM edges WHERE source_id = ? UNION SELECT source_id AS neighbor FROM edges WHERE target_id = ?'
        ).all(nid, nid);
        for (const { neighbor } of edges) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            nextFrontier.push(neighbor);
          }
        }
      }
      frontier = nextFrontier;
    }

    if (visited.size === 0) return [];

    // Fetch all visited nodes in one query
    const placeholders = [...visited].map(() => '?').join(', ');
    const nodes = this.#db.prepare(
      `SELECT * FROM nodes WHERE id IN (${placeholders}) AND salience >= ? ORDER BY salience DESC`
    ).all(...visited, minSalience);

    return nodes.map(r => { r.description = sanitizeNodeDescription(r.description); return r; });
  }

  // ── Tags ─────────────────────────────────────────────────────

  /**
   * Add a tag to a node (idempotent).
   * @param {string} nodeId
   * @param {string} tag
   */
  addTag(nodeId, tag) {
    this.#db.prepare(
      'INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)'
    ).run(nodeId, tag);
  }

  /**
   * Get all tags for a node.
   * @param {string} nodeId
   * @returns {string[]}
   */
  getTags(nodeId) {
    const rows = this.#db.prepare('SELECT tag FROM node_tags WHERE node_id = ?').all(nodeId);
    return rows.map(r => r.tag);
  }

  /**
   * Find nodes that have a given tag.
   * @param {string} tag
   * @param {number} limit
   * @returns {object[]}
   */
  findByTag(tag, limit = 50) {
    const rows = this.#db.prepare(`
      SELECT n.* FROM nodes n
      JOIN node_tags t ON t.node_id = n.id
      WHERE t.tag = ?
      ORDER BY n.salience DESC
      LIMIT ?
    `).all(tag, limit);
    return rows.map(r => { r.description = sanitizeNodeDescription(r.description); return r; });
  }

  // ── Properties (EAV) ─────────────────────────────────────────

  /**
   * Set a property on a node (upsert).
   * @param {string} nodeId
   * @param {string} key
   * @param {string} value
   */
  setProperty(nodeId, key, value) {
    this.#db.prepare(`
      INSERT INTO properties (node_id, key, value) VALUES (?, ?, ?)
      ON CONFLICT(node_id, key) DO UPDATE SET value = excluded.value
    `).run(nodeId, key, value);
  }

  /**
   * Get a single property value.
   * @param {string} nodeId
   * @param {string} key
   * @returns {string|null}
   */
  getProperty(nodeId, key) {
    const row = this.#db.prepare('SELECT value FROM properties WHERE node_id = ? AND key = ?').get(nodeId, key);
    return row ? row.value : null;
  }

  // ── Stats ────────────────────────────────────────────────────

  /**
   * Aggregate statistics about the graph.
   * @returns {{ nodeCount: number, edgeCount: number, typeDistribution: Record<string,number>, avgSalience: number }}
   */
  stats() {
    const { nodeCount } = this.#db.prepare('SELECT COUNT(*) AS nodeCount FROM nodes').get();
    const { edgeCount } = this.#db.prepare('SELECT COUNT(*) AS edgeCount FROM edges').get();
    const { avgSalience } = this.#db.prepare('SELECT COALESCE(AVG(salience), 0) AS avgSalience FROM nodes').get();

    const typeRows = this.#db.prepare('SELECT type, COUNT(*) AS cnt FROM nodes GROUP BY type').all();
    const typeDistribution = {};
    for (const { type, cnt } of typeRows) {
      typeDistribution[type] = cnt;
    }

    return { nodeCount, edgeCount, typeDistribution, avgSalience };
  }

  // ── File Tracking ────────────────────────────────────────────

  /**
   * Get the stored hash for a previously indexed file.
   * @param {string} filePath
   * @returns {string|null}
   */
  getFileHash(filePath) {
    const row = this.#db.prepare('SELECT file_hash FROM indexed_files WHERE LOWER(file_path) = LOWER(?)').get(filePath);
    return row ? row.file_hash : null;
  }

  /**
   * Insert or update a file tracking record.
   * @param {string} filePath
   * @param {string} hash
   * @param {number} nodeCount
   * @param {number} edgeCount
   */
  setFileRecord(filePath, hash, nodeCount, edgeCount) {
    this.#db.prepare(`
      INSERT INTO indexed_files (file_path, file_hash, indexed_at, node_count, edge_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        file_hash  = excluded.file_hash,
        indexed_at = excluded.indexed_at,
        node_count = excluded.node_count,
        edge_count = excluded.edge_count
    `).run(filePath, hash, isoNow(), nodeCount, edgeCount);
  }

  /**
   * List all indexed files.
   * @returns {object[]}
   */
  getIndexedFiles() {
    return this.#db.prepare('SELECT * FROM indexed_files ORDER BY indexed_at DESC').all();
  }
}
