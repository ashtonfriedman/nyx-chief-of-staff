/**
 * Complete DDL for the agent knowledge graph.
 * FTS5 content-table mode with manual sync via triggers.
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS nodes (
    id              TEXT    PRIMARY KEY,
    type            TEXT    NOT NULL,
    name            TEXT    NOT NULL,
    description     TEXT    NOT NULL DEFAULT '',
    salience        REAL    NOT NULL DEFAULT 0.5,
    confidence      REAL    NOT NULL DEFAULT 1.0,
    pinned          INTEGER NOT NULL DEFAULT 0,
    source_file     TEXT,
    source_section  TEXT,
    created_at      TEXT    NOT NULL,
    last_reinforced TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
    source_id       TEXT    NOT NULL,
    target_id       TEXT    NOT NULL,
    relationship    TEXT    NOT NULL,
    weight          REAL    NOT NULL DEFAULT 1.0,
    description     TEXT    NOT NULL DEFAULT '',
    created_at      TEXT    NOT NULL,
    last_reinforced TEXT    NOT NULL,
    PRIMARY KEY (source_id, target_id, relationship),
    FOREIGN KEY (source_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL,
    tag     TEXT NOT NULL,
    PRIMARY KEY (node_id, tag),
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS properties (
    node_id TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    PRIMARY KEY (node_id, key),
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS indexed_files (
    file_path   TEXT PRIMARY KEY,
    file_hash   TEXT NOT NULL,
    indexed_at  TEXT NOT NULL,
    node_count  INTEGER NOT NULL DEFAULT 0,
    edge_count  INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(
    name,
    description,
    content     = 'nodes',
    content_rowid = 'rowid'
);

CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
    INSERT INTO node_fts(rowid, name, description)
    VALUES (new.rowid, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
    INSERT INTO node_fts(node_fts, rowid, name, description)
    VALUES ('delete', old.rowid, old.name, old.description);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE OF name, description ON nodes BEGIN
    INSERT INTO node_fts(node_fts, rowid, name, description)
    VALUES ('delete', old.rowid, old.name, old.description);
    INSERT INTO node_fts(rowid, name, description)
    VALUES (new.rowid, new.name, new.description);
END;

CREATE INDEX IF NOT EXISTS idx_nodes_type        ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_nodes_salience    ON nodes(salience DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_pinned      ON nodes(pinned)       WHERE pinned = 1;
CREATE INDEX IF NOT EXISTS idx_nodes_source_file ON nodes(source_file);
CREATE INDEX IF NOT EXISTS idx_edges_source      ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target      ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_rel         ON edges(relationship);
CREATE INDEX IF NOT EXISTS idx_tags_tag          ON node_tags(tag);
`;

/**
 * Initialize the schema on an open DatabaseSync instance.
 * Safe to call repeatedly — all statements use IF NOT EXISTS.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function initSchema(db) {
  db.exec(SCHEMA_SQL);
}
