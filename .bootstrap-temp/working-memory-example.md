# Working Memory — Example

This is an example of what `memory.md` looks like after a few weeks of active use.
The bootstrap uses this as a reference when seeding the initial memory file.
Delete this file after bootstrap completes.

---

# Working Memory — Memory

Last consolidated: 2025-06-15

## Architecture
- IDEA method: Inputs (inbox), Domains (recurring areas), Expertise (durable knowledge), Archives (completed)
- Repo-local Copilot skills in `.github/skills/` — 23 skills (commit, upgrade, ado-query, ado-work-item, analyze, clarify, daily-dashboard, daily-report, fact-check, graph-index, graph-query, meeting-prep, mind-audit, agent-maintenance, one-on-one-prep, reflect, retro-content-lint, retro-prep, session-recovery, skill-link, source-audit, specify, work-item-health)
- Inbox is quick-capture landing zone; items get triaged to other folders
- Three-file memory system: `memory.md` (curated, ~200 line limit), `rules.md` (one-liner operational rules from mistakes), `log.md` (raw chronological, append-only)
- Knowledge architecture: rules prevent mistakes, expertise enables capability, skills mechanize discipline.
- Canvas extension renders HTML dashboards with SSE live reload
- Cron extension runs scheduled jobs (interval, cron, one-shot) for background automation
- Myelin Memory Graph: SQLite knowledge graph at `graph/`. CLI: `node graph/graph-cli.js {index|query|context|stats}`. Skills: graph-index, graph-query.
- Maintenance daemon: agent-maintenance skill + `.github/scripts/agent-maintenance.ps1` (launcher). Task Scheduler: daily + logon + session unlock. State: `.github/scripts/data/agent-maintenance-state.json`.

## Placement Map

| Content Type | Canonical Location | Links To |
|---|---|---|
| Feature/initiative updates | `initiatives/{name}/{name}.md` | People, stakeholders, other initiatives |
| Stakeholder context | `domains/stakeholders/` or `domains/people/{group}/{name}/` | Initiatives they influence |
| Product context | `domains/products/{name}/` | Related initiatives, stakeholders |
| Person context (working style, preferences) | `domains/people/{group}/{name}/` | Team domain, initiatives |
| Service architecture | `domains/services/{name}.md` | Related repos, initiatives |
| Technical patterns | `expertise/` | Related domains |
| Tasks with deadlines | Initiative `next-actions.md` | ADO work item if team-affecting |
| Decisions | The note they affect + log entry | Log entry for the *why* |
| Agent observations | `.working-memory/log.md` | Wiki-links to topics mentioned |

## ADO Configuration
- **Organization**: {ADO_ORG}
- **Project**: {ADO_PROJECT}
- **Area Path**: {AREA_PATH}
- Feature Effort field = sprints (1 Effort = 1 sprint for 1 dev)
- Story Points = dev days (10 business days per sprint)

## Conventions
- Notes use wikilinks (`[[note-name]]`) for cross-referencing
- One concept per note — update existing notes before creating new ones
- Feature specs use structured HTML
- Tasks include what/why/when and a clear next-action
- Commit messages: conventional commits (`feat:`, `chore:`, `docs:`)
- ADO queries always scoped to area path

## User Context
- **Timezone**: {TIMEZONE}
- **Role**: {ROLE}
- **Scope**: {SCOPE}  <!-- IC, M1 (front-line manager), or M2+ (senior leader) -->

## Active Initiatives
(populated as you work)
