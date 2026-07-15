# Knowledge Graph

SQLite-backed graph index for the IDEA vault. Replaces grep-based retrieval with
ranked, relationship-aware search — without displacing markdown as source of truth.

**Origin**: Cannibalized from [Myelin](https://github.com/shsolomo/myelin) v0.10.8.
Design patterns extracted, implementation built clean with zero dependencies.

## Quick Start

```powershell
# Index the vault (incremental — skips unchanged files)
node graph/graph-cli.js index

# Search the graph
node graph/graph-cli.js query "onboarding"
node graph/graph-cli.js query "scale testing" --type initiative

# Get a specific node with its neighborhood
node graph/graph-cli.js get initiative-onboarding --subgraph

# Generate boot context for agent sessions
node graph/graph-cli.js context --output .working-memory/graph-boot-context.md

# View statistics
node graph/graph-cli.js stats

# Preview salience decay
node graph/graph-cli.js decay --dry-run
```

## Architecture

- **Runtime**: Node 24+ (`node:sqlite` built-in — zero npm dependencies)
- **Database**: `.working-memory/graph.db` (SQLite with WAL, FTS5, foreign keys)
- **Source of truth**: Markdown files. Graph is always a derived index.
- **Security**: All output sanitized (prompt injection, delimiter injection, path traversal)

## Node Types

| Type | Source | Initial Salience |
|------|--------|-----------------|
| domain | `domains/<folder>/` | 0.8 |
| initiative | `initiatives/<folder>/` | 0.8 |
| person | `domains/people/<folder>/` | 0.7 |
| decision | `### Decisions` sections | 0.7 |
| expertise | `expertise/<folder>/` | 0.6 |
| concept | Wikilinks, file references | 0.5 |
| rule | SOUL.md (pinned, never decays) | 1.0 |

## Multi-Instance Strategy

If you run multiple agent instances, each maintains its own `graph.db` file indexed
from its own vault. After syncing content between instances, run `graph index` to
update the graph from new content.
