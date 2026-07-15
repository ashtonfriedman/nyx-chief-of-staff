# Products

Product and service notes track the things your team owns or contributes to.
Each note captures what the product does, who it serves, and current state.

## When to Create a Product Note

- Your team owns or co-owns the product
- You manage its backlog or roadmap
- Stakeholders ask you about it regularly

## Template

```markdown
# {Product Name}

## Overview
- Purpose:
- Primary users:
- Cloud environments: (Public / Gov / Sovereign)

## Current State
- Status: (active / maintenance / decommissioning)
- Key metrics:
- Known gaps:

## Ownership
- PM:
- Eng lead:
- Area path: {AREA_PATH}

## Dependencies
- Upstream: (services/data this product consumes)
- Downstream: (consumers of this product's APIs or data)

## Roadmap
- This semester: {key deliverables}
- Next semester: {planned direction}
```

## Naming Convention

`{product-name}.md` — lowercase, hyphenated. Example: `products/attribute-store.md`
