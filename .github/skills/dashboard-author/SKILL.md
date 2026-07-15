---
name: dashboard-author
description: Authoring pattern for one-off, self-contained HTML "explainer" dashboards that orient a reader on a topic, flow, decision, or analysis at a glance. Use when asked to "build a dashboard", "make a visual", "show me a diagram of this", "write this up as a dashboard", "build an explainer", "explain this visually", or when a prose answer would be easier to grasp as a structured visual. NOT for the recurring data-pipeline dashboards (daily-dashboard, team-dashboard) — those have their own skills.
---

# Dashboard Author

How to build a **one-off explainer dashboard**: a single self-contained HTML file that makes a topic, flow, or decision graspable at a glance, then lets the reader drill down. This is for *explaining* (a feature, an analysis, a process, a comparison) — not for live data pipelines.

## When to use

- "Build me a dashboard for X" / "write this up as a dashboard"
- "Make a diagram of this flow / process / architecture"
- A prose answer has gotten long and would land better as a structured visual
- You've finished an investigation and need to hand the reader something scannable

If the request is a recurring, data-collected dashboard (daily briefing, half close-out, team health), use the dedicated skill instead.

## The mandatory three-tier structure

Every explainer dashboard has these tiers, **in this order**:

### Tier 1 — Orient at a glance (top)
The reader must understand *what this is and the headline* in one read, with **no jargon**.
- **The H1 is the work-item / feature title itself, made a real link** to that feature (ADO URL, doc, source of truth). Do not invent a marketing headline in the H1.
- One plain-language sentence under it stating the bottom line. **Ground the headline in what the thing currently is**, not the aspirational end-state it could grow into.
- Short, concrete, simple words. No acronyms unless universally known; expand or avoid them.
- Imagine the reader has zero context and ten seconds. They should leave knowing the "so what."
- **Include a default-collapsed background block** for everyone who wants more: a `<details>` element (closed by default) holding the context, definitions, history, and any jargon the glance-level intentionally omitted. The glance stays clean; the depth is one click away.

### Honesty & signal discipline (non-negotiable)
These come from real reviewer feedback — violating them destroys trust in the whole board.
- **Honest labels over comforting abstractions.** Never let a status label claim more than the data supports (e.g. don't render "deployed" when you only know "merged/closed"). Show the *evidence-grade* signal — which pipelines/stages actually ran — not an inferred conclusion. A reviewer who knows the domain can smell an overclaim, and one bluff taints every other number on the page.
- **Omit data that can't apply.** Don't show an environment/column/state an item can *never* reach by design (e.g. external-disabled features that never hit AGC prod). Impossible-by-design cells read as "behind" or "broken" — that's misleading noise, not completeness.
- **Collapse to the single decision-relevant signal.** When a set of chips all describe the same axis (dev / ppe / prod), show the one that matters (the highest env reached), not the whole ladder. Reduce, don't enumerate. **But never collapse distinctions that matter operationally** — e.g. keep PPE and PROD separate if code sits in PPE long before prod. Reducing clutter must not erase a real-world difference.
- **Flag the specific exception, not generic status.** A good flag encodes a precise anomaly worth acting on (e.g. "closed story with an unmerged linked PR"), not a restatement of state everyone can already see.

### Tier 2 — Flow / process diagram(s)
Whatever best explains how the thing works or moves.
- Inline **SVG** (no image files, no external libs). Boxes, arrows, lanes, swimlanes — whatever fits.
- Color-code meaning and **include a legend**. Make the legend's colors match the diagram exactly.
- Label arrows with what flows across them. Keep text inside boxes short.
- If there's no flow to show, skip this tier — don't force a diagram.

### Tier 3 — The substance (points / options / decision / data)
Whatever the task actually needs: option cards, a before/after comparison, a risk table, an engineering-scope table, open questions, a recommendation. Use the format that fits the content, not a template.
- **Default to "background → current understanding → tradeoffs / risks", not a stamped verdict.** Even with a single leading recommendation, present the context, what is understood, and the open tradeoffs, and mark the recommendation as a proposal pending sign-off by whoever owns the call. Do not lead with a "Verdict" card or present a recommendation as a settled decision. Don't manufacture a fake comparison or options grid just to fill the tier either.

## House style (non-negotiable)

- **Self-contained.** One `.html` file. All CSS inline in a `<style>` block. All diagrams inline SVG. **No external dependencies, no CDN, no fonts to fetch** — it must open correctly with no network.
- **Opens directly.** `Start-Process <file>.html`. Do **not** require a server unless the user asks for `localhost`.
- **Dark theme.** Match the existing house palette (see `template.html`): near-black background, light text, subtle bordered cards, semantic accent colors (amber = attention/change, green = good/reused, blue = info/config, red = risk, purple = secondary). **Color must be semantic, never decorative.** Every color used carries a defined meaning and appears in a legend; if a color has no meaning, remove it. Prefer no color over unexplained color — an ambiguous tint reads as a code the viewer is failing to decode and erodes trust in the whole board.
- **Cards and pills.** Group content in bordered rounded cards. Use small colored "pills" for status labels.
- **Collapsibles via `<details>`.** Native HTML, no JS needed. The Tier-1 background block is always a `<details>`.
- **Responsive-ish.** Grids collapse to one column on narrow screens via a media query.
- **No JavaScript** unless the dashboard genuinely needs interactivity. Static-first. If interactivity is genuinely needed (filtering, sorting, toggling visibility beyond `<details>`), use a single inline `<script>` at the end of `<body>` — no external libraries, no bundlers.
- **Link every reference.** If you cite a file, symbol, or work item, make it a real clickable link (a `.cs` file → `file:///...`, a feature → its ADO URL). And never style a non-link to *look* like a link — a blue monospace file path reads as a broken hyperlink. Keep code-reference styling visually distinct from real `<a>` links (e.g. neutral gray mono for non-link citations). **Every code reference gets a link — there is no exception for "just a line-number citation." Wrap the filename in `<a>`; line numbers ride along as text inside or beside the link.**
- **`file:///` links are author-local — flag them when the dashboard will be shared.** Local `file:///C:/Users/<you>/...` links only resolve on the author's machine and are dead for anyone the file is sent to. If a dashboard is meant to be shared, say so up front and either (a) produce the PDF (see Exporting) as the shareable copy, or (b) point references at a shared source of truth (ADO/repo web URL) instead of a local path. Don't hand someone a file whose every link is broken for them.
- **Tabular / list views: align columns and link every row entity.** In a rows-and-columns view, use fixed column widths so values line up across rows (per-row `auto`-sized grids never align). Every row's primary entity (story, feature, file) is a real link to its source, not plain text. When the data spans multiple scopes (all features / a single half / one owner), provide a **scope filter** control — don't force the reader to eyeball a superset.
- **Compact by default.** Density is the default, not large type. Smaller body text and tighter spacing than feels natural at first; the reader is scanning a reference, not reading a slide. Use the template's reduced base sizing unless the user asks for larger.
- **Collapsible by default, collapsed by default.** Not just the background block. Every substantive section below the glance is a `<details>` that is *closed* on open. The reader expands what they need. Only the Tier-1 glance sentence is visible on first load.
- **Every pill is wired if it names something linkable.** A "design spec" pill links to the companion doc; a status pill that refers to a work item links to it. A pill that names a real artifact and is not a link is a bug.
- **No redundant sections.** Every section must add net-new information. If a section or tab only restates another, cut it. Do not pad with a section that repeats content already shown elsewhere.
- **Include a glossary block.** Add a dedicated, collapsed glossary/dictionary `<details>` listing every domain term, internal name, and acronym used, each with a one-line plain definition. This is separate from the Tier-1 background block.
- **No names of people.** Use roles, not individuals ("PM decides", "engineering drives the call"), never "John should talk to Jacob." Systems and code symbols are fine; people are not. (Corrected 2026-06-24.)
- **Apply a voice.** A shareable dashboard is a human-facing doc, so the prose needs a consistent voice. Resolve it in this order:
  1. **Configured voice profile** — if the user or team has a writing/voice profile, read it and apply it. **This is a hard first step, not an optional nicety — read the profile before writing any prose, don't reconstruct the voice from memory.** (If your mind has a configured voice profile, e.g. under `expertise/.../writing-voice/`, read it and its `observations.md`.) This always wins.
  2. **Ask for examples** — if none is configured, offer to take a few examples of the desired voice (a paragraph they wrote, a doc they like) and match it.
  3. **Bundled default** — if the user does not want to provide either, fall back to the storyteller voice shipped with this skill: `default-voice.md` in this folder. It is a plain-language, lead-with-the-point explainer voice tuned for orienting a reader with no context.
  Do not block on this. If the user gives no signal, use the default and move on.

## Ground it, don't speculate

A dashboard that explains a decision is only useful if it's accurate. Before framing anything:
- **Read the actual source** — the code, the feature/work item, the meeting notes — and verify load-bearing claims against it. Do not invent payload shapes, mechanics, or behavior. ("Check yourself before you wreck yourself.")
- **Present genuinely open decisions as open**, owned by whoever actually decides (usually PM/customer). Lay out the options neutrally and the question to answer; do not quietly pick the answer and build the whole framing around it. Name the constraint that bounds the decision.
- **Explain any internal/system term inline.** Assume no one downstream has context on a mechanism just because it's named. One plain sentence at the point of use ("on any change it republishes the full set, and Core replaces the old set wholesale").
- **Cut anything the decision-maker can self-serve.** A choice a PM can make in the UI with no engineering change does not belong in an engineering-scope or open-questions section. Keep only what changes what gets built.

## Exporting for offline sharing (PDF)

PDF cannot hold real collapsible sections — the Acrobat-only rich-media trick does not survive Edge, Chrome, Teams preview, or mobile, so don't rely on it. To hand someone a PDF:
1. Copy the HTML to a temp print file and **expand the collapsibles** (`<details>` → `<details open>`) so nothing is hidden.
2. Force colors so the dark theme renders: inside an `@media print` block set `-webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;`.
3. Render headless: `& msedge --headless=new --print-to-pdf="out.pdf" --no-pdf-header-footer (([System.Uri]$printFile).AbsoluteUri)`.
Send the PDF for broad sharing; attach the original HTML for anyone who wants the live links.

## Plain-language rule (the point of Tier 1)

The top of the dashboard is for someone who does **not** live in this problem. Enforce:
- No internal acronyms, class names, or file paths at glance level. Those belong in Tier 3 or the background `<details>`.
- Prefer a verb and a concrete noun over abstraction ("Screening throws away the contract ID" beats "lossy enum projection").
- One idea per sentence.
- If you can't say the headline without jargon, you don't understand it well enough yet — fix that first.

## How to build one

1. **Start from `template.html`** in this skill folder. Copy it next to the relevant artifact (for an initiative, into `initiatives/<slug>/`).
2. **Write Tier 1 first**, in plain language. Get the one-sentence headline right before anything else. Fill the background `<details>`.
3. **Build the SVG flow** for Tier 2 if there's a process to show. Legend colors must match.
4. **Fill Tier 3** with the task-appropriate substance. If you skip Tier 2, Tier 3's first `<h2>` becomes the visual separator — no extra spacing needed.
5. **First open only**: `Start-Process <path>.html` and eyeball it.
6. **Self-check against the checklist below** and fix. **When iterating on a dashboard that is already open, tell the user to refresh the existing browser tab — do not run `Start-Process` again and do not spawn a new tab.** Only re-launch if the file was closed.

## Mechanical pre-handoff lint (run before every handoff)

The three rules most often violated — people names, unlinked file references, and stale
"instance"/topology wording — are all grep-checkable. Run this before showing the user, not
after they catch it:

```powershell
$f = "<path-to-dashboard>.html"
# 1. People names (replace with the actual VIP/first-name list for the context):
Select-String -Path $f -Pattern '\b(Alice|Bob|Carol|Dave)\b'  # <- replace with your context's VIP/first-name list
# 2. File references NOT wrapped in an <a> link (a filename/extension on a line with no href):
Select-String -Path $f -Pattern '\.(json|cs|ts|yml|yaml|md|ps1)\b' | Where-Object { $_.Line -notmatch 'href=' }
```

Any hit on (1) is a bug — swap to a role. Any hit on (2) is an unlinked code reference —
wrap the filename in `<a>`. A clean run is not proof of correctness, but a dirty run is
proof of a defect. Also eyeball diagrams for the recurring "one instance per
location" trap (see house style) — that one is not greppable.

## Quality checklist (run before handing it over)

- [ ] **Jargon test:** read the `<h1>` and the glance sentence *in isolation*. Every noun must make sense to someone who has never touched this codebase/topic. If any word needs the background block to be understood, it's jargon — move it down. The glance must contain **no** file paths, class/function names, unexpanded acronyms, or words that only appear inside the system.
- [ ] **Nothing leaks above the fold:** no text between the `<h1>` and the `<details>` block except the single glance sentence. All other context lives inside `<details>` or in Tier 2/3.
- [ ] Background depth exists but is collapsed by default (`<details>` without `open`).
- [ ] Tiers are in order: orient → diagram → substance.
- [ ] Every diagram has a legend whose colors match the diagram.
- [ ] File is fully self-contained: opens with no network, no external assets.
- [ ] **No effort or time estimates** of any kind (hours, days, weeks, story points, complexity bands) unless the user explicitly asks for sizing. Describe what the work involves, not how long it takes.
- [ ] Claims that came from code/data are cited (file+line, query, or source) — in Tier 3 or background, not the glance.
- [ ] **Every file/symbol/work-item reference is a real link**, and no non-link is styled to look like one. (Run the mechanical lint above — grep for unlinked file extensions.)
- [ ] **If the dashboard will be shared, `file:///` local links are flagged** and a shareable form (PDF, or web/ADO URLs) is offered — the recipient's copy must not be all-dead-links.
- [ ] **No names of people** anywhere in the artifact (roles only).
- [ ] **A voice is applied** (configured profile, user-provided examples, or the bundled `default-voice.md`), consistently across all prose.
- [ ] **Open decisions are framed as open** and owned by the decider, not silently pre-answered; internal terms are explained inline.
- [ ] **No second person.** No "you / your" in the prose; work is described neutrally or passively.
- [ ] **No condescension or reader-coaching.** No "read this first", no telling the reader how to do their job, no instructional parentheticals.
- [ ] **Recommendation framed as a proposal** pending sign-off; no stamped "verdict". Background + understanding + tradeoffs/risks instead.
- [ ] **Title is the feature title and is linked** to the feature; headline describes what the thing is, not the aspiration.
- [ ] **Compact sizing applied**; all substantive sections are `<details>`, collapsed by default.
- [ ] **Every pill that names a linkable artifact is a real link.**
- [ ] **Glossary block present** for domain terms; no section duplicates another.
- [ ] **Iteration uses tab-refresh**, not a new `Start-Process`.
- [ ] No PM-self-service config choices sitting in an engineering-scope/open-questions section.
- [ ] Opens correctly via `Start-Process`.

## Artifact placement

Where dashboards get saved is **configurable per setup, set on first use, then remembered.**

1. **First use** — if no save location is configured, ask the user where explainer dashboards should live (e.g. a `docs/dashboards/` folder, beside the source artifact, or a specific notes repo). Use `ask_user` with a sensible default.
2. **Persist it** — write the chosen convention to a small config so future runs don't re-ask. Store it at `.dashboard-author.config` in the repo root, or in the host's user-config location, whichever the setup uses. Record the base path and whether to nest by slug.
3. **Subsequent uses** — read the saved location and place the file there without prompting. If the user later says "save dashboards somewhere else", update the stored config.
4. **Fallback** — if the user declines to configure anything, save beside the source artifact (or the working directory) and tell them where it landed.

**Co-locate with the topic's existing artifacts; don't bury it.** When the topic already has a home for visuals (e.g. a `diagrams/` folder next to the domain note), put the dashboard *there* rather than at the top of a deep nested path where no one would look. A base-path config is a default, not an excuse to drop a shareable file five levels deep. Ask "where would someone go looking for this?" and put it there.

Dashboards are uncommitted until the user decides to keep them.

> Default: co-locate the file with the topic's existing artifacts — the relevant `initiatives/<slug>/` or `domains/` folder — never a throwaway session/temp folder.

## Anti-patterns

- A wall of cards with no glance-level orientation. Tier 1 is not optional.
- Jargon at the top "because it's faster." The reader you're orienting is the one without context.
- Pulling in Chart.js / D3 / Google Fonts. Self-contained means self-contained.
- Forcing a diagram when there's no flow. A clean comparison table beats a fake diagram.
- Inventing precise story points, or estimating effort/time at all when not asked.
- Inventing mechanics/payloads instead of reading the source. Verify before you assert.
- Naming people in the artifact, or pre-deciding an open design call instead of presenting it as the decider's choice.
- Citing a file or symbol as plain styled text with no link, or styling a non-link to look clickable.
- Handing someone a "shareable" dashboard whose every reference is a `file:///` link dead on their machine.
- Burying a shareable file at the top of a deep nested path instead of co-locating it with the topic's existing diagrams/artifacts.
- Leaving PM-self-service config questions in an engineering-scope section.
- Writing in the second person, or coaching/condescending to an expert reader.
- Stamping a "Verdict" on something that still needs sign-off.
- Re-running `Start-Process` on every edit and piling up browser tabs (refresh instead).
- Sections or tabs that duplicate each other with no net-new data.
