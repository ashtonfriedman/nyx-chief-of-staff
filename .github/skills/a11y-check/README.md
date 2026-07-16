# a11y-check

A small command-line tool that runs a **WCAG accessibility scan** against things you generate
locally — HTML dashboards, SVG diagrams, `.drawio` files, or a page on `localhost` — so you can
catch accessibility problems **before** you share the artifact.

It runs [axe-core](https://github.com/dequelabs/axe-core) inside a headless Chromium browser and
reports violations. No sign-in, no backend, no cloud — just point it at a file or a localhost URL.

---

## Quick start

```bash
cd .github/skills/a11y-check
npm install
npx playwright install chromium
```

Then scan something:

```bash
node lib/scan.js ./dashboard.html
```

You'll get a pass/fail report and an exit code you can use in scripts or CI.

> **The tool checks its own prerequisites.** If a dependency, the Chromium browser, or (for
> `.drawio`) the draw.io CLI is missing, it stops and prints the exact command to fix it instead
> of a stack trace.

---

## What can I scan?

| Target | Example |
|--------|---------|
| A local HTML file | `node lib/scan.js ./output/dashboard.html` |
| A standalone SVG diagram | `node lib/scan.js diagram.svg` |
| A single-page `.drawio` file | `node lib/scan.js architecture.drawio` |
| A page running on localhost | `node lib/scan.js http://localhost:3000` |

Raster images (PNG, JPG, PDF) can't be scanned — they have no DOM to inspect.

---

## Reading the result

The exit code tells you the outcome (handy for scripts and CI):

| Exit code | Meaning |
|-----------|---------|
| `0` | Clean — no violations |
| `1` | Violations or supplemental findings were reported |
| `2` | Something went wrong — bad usage, file not found, unsupported type, or a load failure |

Add `--json` to get machine-readable output instead of the human summary.

### Common options

| Flag | Default | What it does |
|------|---------|--------------|
| `--json` | off | Emit JSON to stdout (diagnostics go to stderr) |
| `--tags <list>` | `wcag2a,wcag2aa` | Which axe rule tags to run |
| `--timeout <ms>` | `30000` | How long to wait for the page to load |
| `--root <path>` | current dir | Folder that file targets must stay inside |
| `--allow-remote` | off | Allow non-localhost URLs (see the security note below) |
| `--verbose` | off | Include HTML snippets of each offending node in JSON output |

---

## What it actually checks

1. **The full axe-core WCAG ruleset** (default: WCAG 2.0 A + AA) — color contrast, missing alt
   text, landmark/heading structure, ARIA misuse, and more.
2. **SVG accessible names** — whether diagrams expose a name (`role="img"` + `<title>`) so screen
   readers can describe them, including the decorative-diagram pass-through case.
3. **SVG text contrast** — axe doesn't check text *inside* SVG; this does, by finding the shape
   actually painted behind each text run and computing the real contrast ratio. When it genuinely
   can't tell (gradients, partial transparency), it flags the text for **manual review** rather
   than guessing.

---

## Scanning `.drawio` files

`.drawio` files need the **draw.io desktop app's CLI** to render the diagram to SVG first:

- **Windows:** `winget install --id JGraph.Draw`
- **macOS:** `brew install --cask drawio`
- **Any OS:** download from the [draw.io desktop releases](https://github.com/jgraph/drawio-desktop/releases)

After installing, either make sure the app's folder is on your `PATH`, or point the tool at the
executable directly:

```bash
# PowerShell
$env:A11Y_DRAWIO_CMD = "$env:LOCALAPPDATA\Programs\draw.io\draw.io.exe"
# bash / zsh
export A11Y_DRAWIO_CMD="/path/to/draw.io"
```

HTML, SVG, and localhost-URL scans **don't** need this — only `.drawio` files do.

---

## A note on safety

The tool treats every target as **untrusted content**. Files are loaded with scripts and network
access blocked; URL targets are restricted to `localhost` by default and pin the resolved IP to
prevent rebinding; DOM text in the report is truncated and sanitized.

**Don't** pass user-supplied URLs with `--allow-remote` in an automated pipeline. Localhost-only is
the safe default and the reason this tool needs no credentials.

---

## Requirements

- **Node.js** (with `npm`)
- **Chromium**, installed once via `npx playwright install chromium` (~150 MB download)
- **draw.io desktop CLI** — only if you want to scan `.drawio` files

---

## For agents

This folder is also a Copilot CLI skill — `SKILL.md` holds the agent-facing definition and trigger
phrases. Humans can ignore that file and use this README.
