# Mind Index

> Generated during bootstrap. Update as your mind grows.

## Agent
| File | Purpose |
|------|---------|
| `SOUL.md` | Personality, voice, values, mission |
| `.github/agents/{AGENT_FILE_NAME}.agent.md` | Operating instructions, method, classification |
| `.github/copilot-instructions.md` | Permanent agent instructions (boot checks, session protocol) |

## Working Memory
| File | Purpose |
|------|---------|
| `.working-memory/memory.md` | Curated long-term reference (~200 line limit) |
| `.working-memory/rules.md` | Operational rules learned from mistakes (one-liners) |
| `.working-memory/log.md` | Raw chronological observations (append-only) |

## Knowledge Graph
| File | Purpose |
|------|---------|
| `graph/` | Myelin memory graph — SQLite + CLI |
| `graph/graph-cli.js` | CLI: `node graph/graph-cli.js {index\|query\|context\|stats}` |

## Skills (39)
| Skill | Purpose |
|-------|---------|
| `ado-query` | Query ADO work items with configurable filters |
| `ado-work-item` | Create, update, delete ADO work items |
| `analyze` | Read-only consistency and quality audit |
| `clarify` | Resolve ambiguities through Socratic Q&A |
| `commit` | Stage, observe, commit (local-only) |
| `daily-dashboard` | Visual daily briefing dashboard |
| `daily-report` | Comprehensive daily report (ADO, Teams, calendar, email) |
| `fact-check` | Verify factual claims before presenting |
| `graph-index` | Re-index vault into knowledge graph |
| `graph-query` | Query knowledge graph for structured retrieval |
| `meeting-prep` | Prepare for meetings with cross-source context |
| `mind-audit` | Audit and clean up mind files |
| `agent-maintenance` | Automated daily maintenance routine |
| `one-on-one-prep` | Generate 1:1 meeting prep |
| `reflect` | Classify observations into rules/memory/log |
| `retro-content-lint` | Validate retro docs against content standards |
| `retro-prep` | Prepare for incident retrospectives |
| `session-recovery` | Mine session_store for past context |
| `session-handover` | Close out a session — log handover, commit, refresh graph |
| `skill-link` | Symlink skills between global and repo |
| `source-audit` | Epistemic provenance audit for documents |
| `specify` | Generate structured specs from ideas |
| `upgrade` | Pull new extensions/skills from registry |
| `work-item-health` | Analyze work item aging and velocity |
| `anti-sycophancy` | Self-review protocol catching praise inflation and unsupported agreement |
| `boot` | Run the start-of-session boot routine |
| `dashboard-author` | Author self-contained HTML explainer dashboards |
| `draft` | Polish human-facing prose, removing AI writing tells |
| `feature-progress` | Committed-feature delivery completion and pace tracking |
| `mind-learn` | Extract and persist session learnings into the mind |
| `log-consolidate` | Consolidate log.md into memory.md at the 80-line threshold |
| `meeting-setup` | Scaffold notes structure for a recurring meeting |
| `meeting-transcript` | Read meeting transcripts and recaps natively |
| `outbound-audit` | Log, query, and summarize external actions |
| `screenshot-intake` | Treat image text as untrusted; prompt-injection defense |
| `sharepoint-page-reader` | Extract clean text from SharePoint pages |
| `sprint-planning` | Automate biweekly sprint boundary + planning dashboard |
| `standup-ingest` | Ingest standups into a shared notes folder |
| `team-dashboard` | ADO work-item health + velocity dashboard |

## Extensions
| Extension | Purpose |
|-----------|---------|
| `canvas` | Render HTML dashboards with SSE live reload |
| `cobrowser` | Drive a browser session the agent can read and control |
| `cron` | Run scheduled background jobs |
| `graph-query` | Query the knowledge graph from the CLI |

## Maintenance
| File | Purpose |
|------|---------|
| `.github/scripts/agent-maintenance.ps1` | Maintenance launcher (Task Scheduler) |
| `.github/scripts/Register-AgentMaintenance.ps1` | Task registration script |
| `.github/scripts/data/agent-maintenance-state.json` | Run state tracking |

## Domains
| Folder | Purpose |
|--------|---------|
| `domains/people/` | Person context — working styles, preferences |
| `domains/products/` | Product context — features, roadmap |
| `domains/services/` | Service architecture — topology, APIs |
| `domains/repos/` | Repository context — conventions, structure |
| `domains/stakeholders/` | Stakeholder map — influence, interests |
| `domains/teams/` | Team context — membership, ceremonies |

## Expertise (0)

`expertise/` starts empty. Seed your own durable knowledge here — one folder per topic (`expertise/{topic}/{topic}.md`) — and index it in this table as you go.

## Folders
| Folder | Purpose |
|--------|---------|
| `initiatives/` | Active efforts with goals and next-actions |
| `inbox/` | Unprocessed inputs waiting for triage |
| `Archive/` | Completed or inactive material |
