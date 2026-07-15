---
name: graph-index
description: Re-index the vault into the knowledge graph. Use when vault files have
  changed and the graph needs updating. Typically run after a significant writing
  session or after absorbing new content.
---

# Graph Index Skill

## Purpose
Rebuild or incrementally update the knowledge graph from the vault markdown files.
Only changed files are re-indexed (SHA-256 hash-based change detection).

## When to Use
- After absorbing new vault content from another source
- After completing a session with significant vault updates
- If graph-query returns stale or missing results
- At the start of a morning session (fast — ~200ms for typical unchanged vaults)

## How to Execute

### Incremental (recommended — fast)
```powershell
node "{USER_HOME}\my-agent\graph\graph-cli.js" index
```

### Force full re-index (after schema changes or corruption)
```powershell
node "{USER_HOME}\my-agent\graph\graph-cli.js" index --force
```

### After indexing, regenerate boot context
```powershell
node "{USER_HOME}\my-agent\graph\graph-cli.js" context --output "{USER_HOME}\my-agent\.working-memory\graph-boot-context.md"
```

### Check graph health
```powershell
node "{USER_HOME}\my-agent\graph\graph-cli.js" stats
```

## Expected Output
```
📂 Indexed vault: {USER_HOME}\my-agent
  📄 Files scanned:    116
  ⏭️  Files skipped:    111  (unchanged)
  📥 Files indexed:      5
  🔢 Nodes added:       12
  🔄 Nodes reinforced:  31
  🔗 Edges added:       18
  ⏱️  Duration:        183ms
```

## Constraints
- Run from any directory — the CLI auto-detects vault root
- graph.db lives at `.working-memory/graph.db` (gitignored)
- Boot context is a static file — must be regenerated after indexing
