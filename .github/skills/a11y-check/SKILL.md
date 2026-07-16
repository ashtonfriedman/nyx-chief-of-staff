---
name: a11y-check
description: >
  Run a WCAG accessibility scan (axe-core via headless Chromium) against locally-generated
  HTML, SVG, .drawio diagrams, or localhost URLs — reporting violations before you share
  the artifact. Use when asked to "check accessibility of a dashboard", "a11y scan this
  HTML/SVG/diagram", "is this diagram accessible", "scan my dashboard for WCAG issues",
  "accessibility check a .drawio", "run axe against this file", or "does this pass WCAG".
---

# a11y-check

Run axe-core against local DOM artifacts (HTML, SVG, .drawio, localhost URL) in headless
Chromium and report WCAG violations so anyone can validate dashboards and diagrams before
sharing them. It works on un-gated local artifacts and plain URLs — no SSO, no backend,
just a file or localhost page.

## Setup

```powershell
cd .github/skills/a11y-check
npm install
npx playwright install chromium
```

`node_modules` is gitignored; re-run after cloning.

### Prerequisites (the skill checks these for you)

Before each scan the tool runs a **preflight self-check** and, if anything is
missing, exits with copy-paste install steps instead of a stack trace:

| Needed for | Prerequisite | Install |
|------------|--------------|---------|
| All scans | npm deps (`playwright`, `axe-core`, `@axe-core/playwright`) | `npm install` (in this folder) |
| All scans | Playwright Chromium browser (~150 MB) | `npx playwright install chromium` |
| `.drawio` only | draw.io desktop CLI | `winget install --id JGraph.Draw` (Win) · `brew install --cask drawio` (macOS) · [releases](https://github.com/jgraph/drawio-desktop/releases) |

HTML, SVG, and localhost-URL targets need only Node + Chromium. The draw.io CLI
is required **only** for `.drawio` files.

## Usage

```
node lib/scan.js <target> [options]
```

### Supported targets

| Target | Example |
|--------|---------|
| Local HTML file | `node lib/scan.js ./output/dashboard.html` |
| Standalone SVG | `node lib/scan.js diagram.svg` |
| Single-page .drawio | `node lib/scan.js arch.drawio` |
| Localhost URL | `node lib/scan.js http://localhost:9999` |

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--json` | off | JSON output to stdout (diagnostics to stderr) |
| `--tags <list>` | `wcag2a,wcag2aa` | Comma-separated axe tag set |
| `--timeout <ms>` | `30000` | Page-load timeout |
| `--root <path>` | cwd | Allowed scan root for file targets |
| `--allow-remote` | off | Permit non-localhost URL targets |
| `--verbose` | off | Include `node.html` snippets in JSON output |

### Exit codes

- **0** — no violations
- **1** — violations or supplemental findings found
- **2** — usage error, target not found, unsupported type, or load failure

## What it checks

1. **axe-core** with configurable WCAG tags (default: 2.0 A + AA). Covers color-contrast,
   missing alt, landmark structure, ARIA misuse, etc.
2. **Supplemental SVG accessible-name check (FR-010)** — axe's `svg-img-alt` only fires
   when `role="img"` is already present. This check covers the full decision tree:
   top-level `<svg>` with no role and no name, image/graphics roles without a name,
   empty `aria-label`, and decorative (`role="none"`/`role="presentation"`) pass-through.
   Nested `<svg>` inside a parent `<svg>` are excluded unless they have an explicit role.
3. **Supplemental SVG text-contrast check (FR-009)** — axe doesn't check `<text>` contrast
   inside SVG. This check resolves the foreground fill and walks the ancestor chain for a
   solid background, then computes the WCAG 2.1 contrast ratio. Flags `<text>`/`<tspan>`
   elements below 4.5:1. When the foreground or background can't be determined (gradients,
   patterns, partial opacity, `fill="none"`), emits an informational "contrast-unknown —
   manual review recommended" note that does NOT affect the exit code.

## Known limitations / out of scope

- **SVG contrast skip cases** — gradients, patterns, image fills, `fill-opacity < 1`,
  RGBA with alpha, and sibling-overlap backgrounds produce an informational note (not a
  violation). The large-text 3:1 exception is not yet implemented (4.5:1 applied universally).
- **Multi-page .drawio** — only page 0 is scanned today.
- **Raster images (PNG, JPG, PDF)** — no DOM, not scannable.
- **SSO-gated web apps** — out of scope; this tool targets un-gated artifacts and plain URLs.

## .drawio support

Requires an external draw.io renderer (the desktop app's CLI export). The tool looks for:

1. `A11Y_DRAWIO_CMD` env var (path to the renderer executable)
2. Platform default on PATH: `draw.io` (macOS), `drawio` (Linux), `draw.io.exe` (Windows)

On headless Linux, `xvfb-run` may be needed. If the renderer is absent, the tool exits 2
with a clear message — it does not silently skip.

Install the renderer (draw.io desktop): Windows `winget install --id JGraph.Draw`,
macOS `brew install --cask drawio`, or download from
https://github.com/jgraph/drawio-desktop/releases. After install, either ensure its
folder is on `PATH` (new shells) or point `A11Y_DRAWIO_CMD` at the executable, e.g.
`A11Y_DRAWIO_CMD="$env:LOCALAPPDATA\Programs\draw.io\draw.io.exe"`. Cold-start of the
Electron export can take tens of seconds.

## Security guidance

Targets are treated as **untrusted content** (two security review rounds drove this):

- **Scan-root confinement (SR-001):** file targets are canonicalized via `realpath` and
  rejected if they escape the allowed root (default: cwd). Symlink attacks are blocked.
- **No file:// navigation:** HTML/SVG are loaded via `page.setContent()` under
  `about:blank` origin with a CSP blocking scripts and network (`script-src 'none';
  connect-src 'none'`).
- **SSRF policy (SR-002):** URL targets resolve DNS → validate IP → pin the validated IP
  for navigation (DNS rebinding defense). Loopback, link-local, RFC-1918, and metadata
  IPs are blocked on redirects. Remote URLs require explicit `--allow-remote`.
- **Network confinement (SR-003):** `page.route('**/*')` intercepts all page-initiated
  requests — block-all for file targets, same-origin-only for URL targets. Fail-closed.
- **Output sanitization (SR-005):** DOM-derived strings truncated to 200 chars, control
  chars stripped, `node.html` omitted by default (prompt-injection mitigation).

⚠️ **Never pass user-supplied URLs with `--allow-remote`** in automated pipelines.
Localhost-only is the safe default.

## Related

- **`README.md`** — human-facing overview, install, and usage guide
- Design docs (spec, review trail, implementation plan) are maintained in the upstream
  source repository, not shipped with the distributed skill.
