---
name: graph-query
description: Query the agent knowledge graph to retrieve structured vault knowledge.
  Use when asked to find related concepts, trace dependencies between initiatives,
  look up past decisions, or find who works on what.
---

# Graph Query Skill

## Purpose
Execute structured queries against the local knowledge graph (graph.db) to retrieve
semantically ranked vault knowledge beyond what grep can find.

## When to Use
- "What decisions have we made about X?"
- "What initiatives depend on Y?"
- "Who's involved in the payments service?"
- "What patterns relate to authentication?"
- "Find everything about the onboarding initiative"

## How to Execute

### Full-text search (most common)
```powershell
node "{USER_HOME}\my-agent\graph\graph-cli.js" query "<term>" --limit 10
```

### Filtered by type
```powershell
node "{USER_HOME}\my-agent\graph\graph-cli.js" query "<term>" --type decision --limit 5
node "{USER_HOME}\my-agent\graph\graph-cli.js" query "<term>" --type initiative
```

### Get a specific node with its neighborhood
```powershell
node "{USER_HOME}\my-agent\graph\graph-cli.js" get <node-id> --subgraph --depth 2
```

### Available node types
`domain`, `initiative`, `expertise`, `person`, `decision`, `concept`, `pattern`, `rule`, `next_action`

## Output Interpretation
Results are JSON lines: `{ node: { id, type, name, description, salience }, score }`
where `score` is BM25 relevance (higher = more relevant). Incorporate the top results
into your response, citing the node type and salience.

## Constraints
- Read-only — this skill never modifies the graph
- Graph may be up to 24h stale; for current state always defer to markdown files
- Do not expose raw node IDs or salience scores to end users
- FTS5 does not stem — use exact terms or wildcards (term*)
