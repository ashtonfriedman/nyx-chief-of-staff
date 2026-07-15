# Agent Starter Kit (v3)

A pre-configured AI agent workspace for product managers, engineering managers, and individual contributors, built on the IDEA method (Inputs, Domains, Expertise, Archives).

## What's Inside

| Component | Count | Description |
|-----------|-------|-------------|
| Skills | 39 | ADO queries, sprint and quarterly planning dashboards, delivery-pace tracking, daily reports, meeting prep, spec writing, draft polishing, and more |
| Agents | 15 | Chief of staff, product storyteller, security/privacy reviewers, implementation planners, threat modelers |
| Expertise | 0 | Starts empty — seed your own durable knowledge (planning notes, 1:1 templates, capacity planning, backlog management, feature reporting, work-item triage, initiative hygiene, management craft, incident response) |
| Extensions | 4 | Canvas (HTML dashboards), Cron (scheduled jobs), Cobrowser (browser automation), Graph-query (knowledge-graph tools) |
| Knowledge Graph | ✓ | Myelin — indexes your vault for structured queries; `manifest` command auto-generates mind-index |
| Maintenance | ✓ | Auto-consolidation, audit, and graph indexing, with a mechanized boot routine |
| Rules | 105+ | Pre-loaded operational patterns learned from production use |

## What's New in v3

This refresh closes ~10 weeks of capability drift between v2 (April 2026) and the current agent framework. The bootstrap tailors the agent to your discipline (PM or Eng) and scope (IC, M1 front-line manager, or M2+ senior leader), so the skill set you lead with matches your role.

- **New skills**, including: `team-dashboard` and `sprint-planning` (ADO health/velocity + biweekly boundary automation), `feature-progress` (delivery tracking and risk warnings), `draft` (kills AI writing tells), `standup-ingest`, `meeting-transcript`, `screenshot-intake` (prompt-injection defense), and a mechanized `boot` + `log-consolidate` pair.
- **7 new expertise areas**: `ado-feature-reporting`, `ai-work-item-triage`, `initiative-hygiene`, `ado-work-item-voice`, `ado-wiki-editing`, plus harvested `management-craft` (SBI feedback, product narrative) and `communication` (transcript retrieval).
- **1 new agent**: `privacy-threat-modeler` (LINDDUN privacy impact assessments).
- **Mechanized boot**: `boot-context.mjs` replaces the manual boot checklist; reads a materialized `graph-boot-context.md` index instead of loading memory/rules eagerly.
- **Infra**: Cobrowser + Graph-query extensions, SharePoint MCP server, graph `manifest` command, completed maintenance launcher/registration scripts.
- **Sharper rules + leaner memory seed**: new accuracy/distribution rules and a pointers-not-content memory model.

## Quick Start (Fresh Install)

```powershell
# 1. Extract the zip to your desired location
Expand-Archive agent-starter-kit-v3.zip -DestinationPath C:\Users\$env:USERNAME\my-agent

# 2. Navigate and run setup
cd C:\Users\$env:USERNAME\my-agent
.\setup.ps1
# Setup will ask for permission before installing the Copilot CLI if needed.
# Answer the prompt, or pass -InstallCli to opt in up front:
#   .\setup.ps1 -InstallCli

# 3. Start a Copilot CLI session in this folder
copilot
# Then type "hi" to kick off the guided bootstrap protocol.
# Follow the 14-step guided setup to configure your SOUL, memory, and domain files
```

### Setup script won't run? (PowerShell execution policy)

Windows blocks unsigned scripts by default, and files extracted from a downloaded
zip are additionally flagged with a "mark of the web". If `.\setup.ps1` fails with
`running scripts is disabled on this system` or `is not digitally signed`, use one
of these:

```powershell
# Option A — unblock the file (clears the downloaded-from-internet flag), then run
Unblock-File .\setup.ps1
.\setup.ps1

# Option B — run once, bypassing policy for this process only (no machine changes)
powershell -ExecutionPolicy Bypass -File .\setup.ps1

# Option C — sign it yourself (only if your org requires signed scripts and you
# have a code-signing certificate)
$cert = (Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert)[0]
Set-AuthenticodeSignature -FilePath .\setup.ps1 -Certificate $cert
```

## Already running an older kit?

This is a full, self-contained kit — the simplest path is a **fresh install** (above) into a new folder, then bring over your own `SOUL.md`, `memory.md`, `log.md`, domain files, and initiatives. An in-place `upgrade-v2.ps1` helper is included for existing v2 installs; run it with `-DryRun` first to preview, and note it never touches your `SOUL.md`, `memory.md`, `log.md`, domains, initiatives, or inbox.

## Directory Structure

```
SOUL.md                    ← Your agent's personality (generated at bootstrap)
mind-index.md              ← Catalog of all generated files
.github/
  copilot-instructions.md  ← Agent operating instructions
  agents/                  ← 15 specialized AI agents
  extensions/              ← Canvas, Cron, Cobrowser, Graph-query
  scripts/                 ← Maintenance automation
  skills/                  ← 39 callable skills
.working-memory/
  memory.md                ← Long-term reference knowledge
  rules.md                 ← Operational rules (105+ pre-loaded)
  log.md                   ← Session log (append-only)
.bootstrap-temp/           ← First-run setup templates (safe to delete after bootstrap)
domains/                   ← People, teams, products, services, stakeholders
expertise/                 ← Durable knowledge and reference material
graph/                     ← Myelin knowledge graph
inbox/                     ← Incoming items to triage
initiatives/               ← Active projects and goals
Archive/                   ← Completed work
```

## Role-Tailored Features

- **Chief of Staff agent**: Orchestrates priorities, meetings, and communications
- **Product Storyteller agent**: Frames features as business narratives
- **Planning-cycle expertise**: Budget-based prioritization with technical analysis
- **1:1 templates**: Structured prep for hierarchy, direct, and peer meetings
- **Capacity planning**: Sprint math with velocity tracking
- **Backlog management**: Feature lifecycle from ideation to sprint
- **Sprint ceremonies**: Planning, standup, review, and retro guides

## Daily Workflow

```
"daily report"          → Morning briefing (ADO + Teams + Calendar + Email)
"daily dashboard"       → Visual HTML dashboard at localhost:9999
"team dashboard"        → ADO work-item health + velocity dashboard
"sprint planning"       → Biweekly sprint boundary + planning dashboard
"feature progress"      → Committed-feature delivery + pace tracking
"prep my 1:1s"          → Structured prep for upcoming 1:1 meetings
"run maintenance"       → Log consolidation + audit + graph re-index
```

## Requirements

- Windows 10/11
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli)
- Node.js 18+ (for knowledge graph and extensions)
- Git (for version control)

## Version

- **v3** — June 2026 (refresh: +19 skills, +1 agent, +7 expertise areas, mechanized boot)
- **v2** — April 2026

## Credits

This starter kit descends from **[genesis](https://github.com/ianphil/genesis)** by
[@ianphil](https://github.com/ianphil) — the portable, personal-repo agent framework that
established the markdown-mind + working-memory + skills pattern this kit builds on. Genesis
is the origin; the expertise content, knowledge graph, extended skill set, and bootstrap
protocol here are extensions of that foundation.
