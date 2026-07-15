# Working Memory — Memory

Last consolidated: (not yet)

## Architecture
- IDEA method: Inputs (inbox), Domains (recurring areas), Expertise (durable knowledge), Archives (completed)
- Repo-local Copilot skills in `.github/skills/` — 44 total
- Inbox is quick-capture landing zone; items get triaged to other folders
- Three-file memory system: `memory.md` (curated, ~200 line limit), `rules.md` (one-liner rules from mistakes), `log.md` (raw chronological, append-only)
- Knowledge architecture: rules prevent mistakes, expertise enables capability, skills mechanize discipline
- Pointers, not content: if a fact has a canonical home (a domain, expertise, or initiative file), memory.md points to it rather than duplicating it. Memory holds session orientation and small constants only — if it doesn't need to be read every session, it doesn't belong here.
- Canvas extension renders HTML dashboards with SSE live reload
- Cron extension runs scheduled jobs (interval, cron, one-shot)
- Myelin Memory Graph: SQLite knowledge graph at `graph/`. CLI: `node graph/graph-cli.js {index|query|context|stats|manifest}`. Skills: graph-index, graph-query.
- Maintenance daemon: agent-maintenance skill + `.github/scripts/agent-maintenance.ps1`. Registered via Task Scheduler (daily + logon + unlock). State: `.github/scripts/data/agent-maintenance-state.json`.

## Placement Map

| Content Type | Canonical Location | Links To |
|---|---|---|
| Feature/initiative updates | `initiatives/{name}/{name}.md` | People, stakeholders, other initiatives |
| Person context | `domains/people/{group}/{name}/` | Team domain, initiatives they touch |
| Stakeholder context | `domains/stakeholders/{name}.md` | Products, initiatives they influence |
| Product/service context | `domains/products/{name}.md` | Services, stakeholders, roadmap |
| Technical patterns | `expertise/` | Related domains |
| Tasks with deadlines | Initiative `next-actions.md` | ADO work item if team-affecting |
| Decisions | The note they affect + log entry | Log entry for the *why* |
| Agent observations | `.working-memory/log.md` | Wiki-links to topics mentioned |
| Coaching / performance / HR / level / schedule | The person's file ONLY | never memory.md, never broad or shared surfaces |

## ADO Configuration
- **Organization**: {ADO_ORG}
- **Project**: {ADO_PROJECT}
- **Area Path**: {AREA_PATH}
- Feature effort field: `Microsoft.VSTS.Scheduling.Effort` (sprints, NOT story points)
- Story points = dev days (1 SP ≈ 1 dev day, ~10 biz days/sprint)
- Always scope queries to area path

## Conventions
- Notes use wikilinks (`[[note-name]]`) for cross-referencing
- One concept per note — update existing notes before creating new ones
- Tasks include what/why/when and a clear next-action
- ADO queries always scoped to area path

## User Context
- **Timezone**: (set during bootstrap)
- **Role**: (set during bootstrap)
- **Scope**: (set during bootstrap — IC / M1 / M2+)

## Active Initiatives
(none yet)
