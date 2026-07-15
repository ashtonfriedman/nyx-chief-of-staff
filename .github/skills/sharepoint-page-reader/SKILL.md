---
name: sharepoint-page-reader
description: Extract clean readable text from SharePoint modern pages (.aspx) by chaining metadata lookup, ASPX read, CanvasContent1 decode, and webpart text extraction. Use when an agent task requires page content from a SharePoint URL, example.com short link, or a known DriveItem file ID — instead of re-deriving the three-layer parsing chain on every invocation.
---

# SharePoint Page Reader

Extract human-readable text from SharePoint modern pages (`.aspx`) without forcing the calling agent to reinvent the three-layer ASPX → HTML-decode → JSON → webpart-text decode chain. Returns a structured `PageReadResult` regardless of success or partial failure.

---

## When to Invoke

Invoke this skill when:
- The user provides a SharePoint page URL (e.g., a `.sharepoint.com/.../sitepages/foo.aspx` link) and asks what it says
- The user provides an `example.com` or other short link that ultimately points to a SharePoint page
- The agent already has a DriveItem `fileId` + `documentLibraryId` from a prior metadata call and needs the page's readable text
- The agent needs to summarize, search, or quote content from a modern SharePoint page

**Trigger patterns:**
- "What does this page say: {URL}"
- "Read this SharePoint page"
- "Summarize example.com/our-page"
- Internal: any agent flow that needs the textual content of a SharePoint modern page

## When NOT to Invoke

⛔ Do NOT use this skill for:

- **Classic SharePoint pages** — pages without a `<mso:CanvasContent1>` canvas (pre-2016 team sites, publishing pages). They have a fundamentally different ASPX structure and are out of scope (NFR-003).
- **Files, images, or attachments** — embedded documents, image alt text, file previews, attachment content. This skill extracts text only.
- **Pages over 5 MB raw ASPX** — exceeds the SharePoint MCP `readSmallTextFile` limit. The skill detects this in Phase 1 and returns a structured error.
- **Writing or modifying pages** — read-only. No updates, edits, or publish actions under any condition.
- **Visual layout fidelity** — column structure, table formatting, and webpart visual hierarchy are not preserved. Output is plain readable text in webpart order.
- **Authentication acquisition** — relies on the existing authenticated SharePoint MCP session. Does not acquire tokens or prompt for credentials.

---

## Input Contract — `PageReadRequest` (DM-001)

Caller MUST provide exactly one of:
- `pageUrl` — full SharePoint page URL or redirect URL (e.g., `example.com/...`)
- `fileId` + `documentLibraryId` — DriveItem ID and parent drive ID for the `.aspx` file

Optional:
- `siteContext` — site ID hint when URL path structure is ambiguous

If both `pageUrl` and `fileId` are provided, prefer `fileId` (the caller already did the resolution) and ignore `pageUrl` for resolution but still record it as `resolvedUrl` if it matches the metadata `webUrl`.

---

## Output Contract — `PageReadResult` (DM-002)

Always return a structured result, even on failure. Never throw an unhandled exception, never return a bare string.

```
{
  "text": "<extracted readable text, or empty string>",
  "pageTitle": "<page title from htmlTitle webpart or metadata display name, or empty string>",
  "webpartCount": <integer — total webparts in CanvasContent1>,
  "extractedWebpartCount": <integer — webparts that yielded ≥1 non-empty text fragment>,
  "warnings": ["<non-fatal condition>", ...],
  "error": "<error message>" | null,
  "resolvedUrl": "<canonical SharePoint URL>",
  "resolvedFileId": "<DriveItem file ID used for the read>"
}
```

Error semantics:
- `error: null` — extraction completed (text may still be empty if no text webparts were found; see `warnings`)
- `error: "<message>"` — extraction could not complete (e.g., size > 5 MB, redirect could not be resolved, metadata lookup failed). Other fields populated as far as the pipeline reached.

---

## Phase 0 — Input Pre-flight

Before any Graph API call, validate the input and resolve redirects.

### Step 0.1 — Input shape validation

Confirm exactly one input mode is present:
- Mode A: `pageUrl` is provided
- Mode B: `fileId` AND `documentLibraryId` are provided

If neither or both modes are missing required fields, return:
```
{ "error": "Provide either pageUrl, or both fileId and documentLibraryId", ...other fields empty/zero }
```

### Step 0.2 — Redirect detection (Mode A only)

Parse the `pageUrl` host. If the host does NOT end in `.sharepoint.com`, treat it as a redirect URL.

```powershell
$uri = [Uri]$pageUrl
$isRedirect = -not $uri.Host.EndsWith('.sharepoint.com', [StringComparison]::OrdinalIgnoreCase)
```

### Step 0.3 — Redirect resolution

If `$isRedirect` is true, resolve it before proceeding:

1. Call the `web_fetch` tool with the redirect URL and `raw: false`
2. Inspect the response for the final URL — most `web_fetch` implementations expose either a `finalUrl` field, a `Content-Location` header, or the resolved URL in the response body
3. If the final URL host ends in `.sharepoint.com`, set `$pageUrl = $finalUrl` and continue to Phase 1
4. If `web_fetch` is unavailable, returns no resolved URL, or the final URL is still not a SharePoint host, return:
   ```
   { "error": "Could not resolve redirect to a SharePoint URL", "resolvedUrl": "<original input>", ... }
   ```

Document the resolved URL in `resolvedUrl` regardless of whether resolution succeeded.

---

## Phase 1 — URL Resolution and Size Guard

**Mode A (pageUrl input):**

Call the SharePoint MCP tool to resolve metadata:
```
sharepoint-getFileOrFolderMetadataByUrl(fileOrFolderUrl: <pageUrl>)
```

Extract from the response:
- `id` → `resolvedFileId`
- `parentReference.driveId` → `documentLibraryId`
- `webUrl` → `resolvedUrl`
- `size` → bytes for the size guard
- `name` → fallback `pageTitle` if no `htmlTitle` is found later

If the metadata call fails or returns no `id`, return:
```
{ "error": "Metadata lookup failed: <underlying message>", "resolvedUrl": "<pageUrl>", ... }
```

**Mode B (fileId + documentLibraryId input):**

Skip the URL-based metadata call. Instead call:
```
sharepoint-getFileOrFolderMetadata(documentLibraryId: <docLibId>, fileOrFolderId: <fileId>)
```

Extract `webUrl` → `resolvedUrl`, `size` → bytes, `name` → fallback `pageTitle`. Use the caller-supplied `fileId` and `documentLibraryId` directly for the read in Phase 2.

### Size guard (NFR-004, fires BEFORE Phase 2)

If `size > 5242880` (5 MB):
```
{ "error": "Page exceeds the 5 MB read limit; use an alternative extraction path",
  "resolvedUrl": "<webUrl>", "resolvedFileId": "<id>", "warnings": [], ...counts zero }
```

Do NOT attempt the read.

If `size` is missing from the metadata response, log a warning (`"File size not present in metadata; proceeding without pre-check"`) and continue — `readSmallTextFile` will surface its own size error if exceeded.

---

## Phase 2 — ASPX Read

Call:
```
sharepoint-readSmallTextFile(documentLibraryId: <docLibId>, fileId: <fileId>)
```

Store the returned content as the raw ASPX string. The MCP tool returns the file content as a single string.

If the read fails, return:
```
{ "error": "ASPX read failed: <underlying message>", "resolvedUrl": ..., "resolvedFileId": ..., ...counts zero }
```

---

## Phase 3 — CanvasContent1 Extraction and Decode Chain

The decode chain is run in PowerShell to leverage `[System.Net.WebUtility]::HtmlDecode` and `ConvertFrom-Json`. Inline snippet:

```powershell
# Input: $aspx (the raw ASPX string from Phase 2)

# Step 3.1 — Extract CanvasContent1
$pattern = '<mso:CanvasContent1[^>]*>(.*?)</mso:CanvasContent1>'
$match = [regex]::Match($aspx, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $match.Success) {
    # Branch: no canvas content — see Phase 5 empty-result handling
    return @{ noCanvas = $true }
}
$encoded = $match.Groups[1].Value

# Step 3.2 — Multi-pass HTML entity decode (FR-006)
$decoded = [System.Net.WebUtility]::HtmlDecode($encoded)
$decoded = [System.Net.WebUtility]::HtmlDecode($decoded)

# Step 3.3 — Triple-encoding detection (rare; specific third-party webparts)
# Trigger ONLY when residual entities appear at JSON-structural positions
# (immediately after '[' or ',') — avoids false positives on legitimate
# string content that happens to contain entity-shaped sequences.
if ($decoded -match '(\[|,)\s*&amp;' -or $decoded -match '(\[|,)\s*&#') {
    $decoded = [System.Net.WebUtility]::HtmlDecode($decoded)
    $tripleDecodeApplied = $true
}

# Step 3.4 — Parse as JSON webpart array
try {
    $webparts = $decoded | ConvertFrom-Json
} catch {
    return @{ parseError = $_.Exception.Message }
}
```

If Step 3.1 returns `noCanvas`, jump to Phase 5 and assemble:
```
{ "text": "", "pageTitle": "<from metadata name>", "webpartCount": 0,
  "extractedWebpartCount": 0, "warnings": ["No canvas content found"], "error": null, ... }
```

If Step 3.4 raises a parse error, return:
```
{ "error": "CanvasContent1 JSON parse failed: <message>", "warnings": [...if tripleDecodeApplied: "Triple-encoding fallback applied; parser still failed"], ... }
```

Append `"Triple-encoded entities detected; third decode pass applied"` to `warnings` whenever `$tripleDecodeApplied` is true.

---

## Phase 4 — Webpart Iteration and Text Extraction

Iterate `$webparts` in array order. For each webpart, extract text in this precedence order (FR-008):

1. `searchablePlainTexts` — values dictionary; concatenate all values with newlines
2. `htmlTitle` — string field
3. `innerHTML` — string field
4. `data-sp-rte` — string field (some webparts)

The first non-empty source wins. Do NOT concatenate across precedence levels for the same webpart (otherwise you get duplicated content).

For each extracted fragment:
1. Strip HTML tags: `$text -replace '<[^>]+>', ''`
2. HTML-decode once more (some webpart types double-encode within their own fields): `[System.Net.WebUtility]::HtmlDecode($text)`
3. Trim whitespace; discard if empty after trim

Track per webpart:
- `webpartCount` — total iterated
- `extractedWebpartCount` — count where ≥1 non-empty fragment was produced

For the FIRST webpart whose `htmlTitle` field contains the page title (typically a TextWebPart at position 0 or 1), capture it as `pageTitle` for the output. If no webpart yields a title, fall back to the metadata `name` from Phase 1.

Inline:
```powershell
$fragments = @()
$pageTitle = ""
$extractedCount = 0
$webpartIndex = 0
$perWebpartWarnings = @()

foreach ($wp in $webparts) {
    $webpartIndex++
    $text = ""

    if ($wp.searchablePlainTexts) {
        $text = ($wp.searchablePlainTexts.PSObject.Properties.Value -join "`n")
    } elseif ($wp.htmlTitle) {
        $text = [string]$wp.htmlTitle
    } elseif ($wp.innerHTML) {
        $text = [string]$wp.innerHTML
    } elseif ($wp.'data-sp-rte') {
        $text = [string]$wp.'data-sp-rte'
    }

    $text = $text -replace '<[^>]+>', ''
    $text = [System.Net.WebUtility]::HtmlDecode($text)
    $text = $text.Trim()

    if ($text) {
        $fragments += $text
        $extractedCount++
        if (-not $pageTitle -and $wp.htmlTitle) { $pageTitle = [string]$wp.htmlTitle -replace '<[^>]+>', '' }
    } else {
        $wpType = if ($wp.webPartType) { $wp.webPartType } else { 'unknown' }
        $perWebpartWarnings += "Webpart $webpartIndex (type: $wpType): no text-bearing fields found"
    }
}

$webpartCount = $webpartIndex
```

### Empty-result branches (FR-011, FR-012)

After iteration:
- If `webpartCount > 0` and `extractedCount == 0` → append `"No text webparts found"` to top-level `warnings` (in addition to per-webpart warnings)
- If `webpartCount == 0` (an empty CanvasContent1 array) → append `"CanvasContent1 was present but contained no webparts"` to `warnings`

Append the per-webpart warnings array to the top-level `warnings` (these surface partial-coverage information for SC-004 / US-05).

---

## Phase 5 — Output Assembly

Concatenate fragments in webpart order, separated by blank lines (`"`n`n"`):

```powershell
$text = $fragments -join "`n`n"
```

Build the canonical `PageReadResult`:

```
{
  "text": "<concatenated fragments>",
  "pageTitle": "<from htmlTitle, or metadata name fallback>",
  "webpartCount": <integer>,
  "extractedWebpartCount": <integer>,
  "warnings": [<top-level + per-webpart>],
  "error": null,
  "resolvedUrl": "<webUrl from metadata>",
  "resolvedFileId": "<DriveItem id>"
}
```

Present this result block to the calling agent. The agent uses `text` for downstream summarization or quoting and inspects `warnings` to describe coverage to the user accurately.

---

## Rules

### ⛔ Read-Only — HARD BLOCK

This skill performs ZERO writes. No Teams posts, no SharePoint writes, no email, no ADO mutations, no GitHub commits, no canvas/UI side effects. The only outbound calls are:
- `web_fetch` (read, redirect resolution)
- `sharepoint-getFileOrFolderMetadataByUrl` (read)
- `sharepoint-getFileOrFolderMetadata` (read)
- `sharepoint-readSmallTextFile` (read)

### ⛔ Modern Pages Only

The skill targets `.aspx` files containing a `<mso:CanvasContent1>` canvas. Classic SharePoint pages, publishing pages, and non-canvas-based pages are out of scope. When the canvas is absent, return a structured result with `"No canvas content found"` rather than attempting alternative parsing.

### ⛔ 5 MB Gate Fires BEFORE the Read

The size pre-check runs against metadata in Phase 1. If `size > 5242880` bytes, return the size error immediately — DO NOT call `readSmallTextFile`. This prevents wasted MCP calls and aligns with NFR-004.

### ⛔ All Edge Cases Produce DM-002

Every code path in this skill must terminate by emitting a valid `PageReadResult`:
- Success → `error: null`, populated text or empty with warnings
- Recoverable failure → `error: <message>`, partial fields populated as far as the pipeline reached
- No path may throw, raise, or return a bare string. Unhandled exceptions are a defect (NFR-002, SC-002).

### ⛔ `web_fetch` Unavailability is a Surfaced Error

If `web_fetch` is unavailable in the agent's session and a redirect URL was provided, return `error: "Could not resolve redirect; web_fetch unavailable"`. Do NOT attempt to call SharePoint metadata with a non-SharePoint URL — `getFileOrFolderMetadataByUrl` will fail in a less informative way.

### Triple-Decode Heuristic

The third HTML-decode pass is gated by detection of `&amp;` or `&#` immediately after `[` or `,` in the decoded payload (JSON-structural positions). This avoids false positives on legitimate string content. The detection is documented as a heuristic — if a future webpart format triggers it incorrectly, the symptom will be a JSON parse failure on the third pass, surfaced via the parse-error branch in Phase 3.

### Idempotency

Given the same input (URL or fileId+docLibId) and the same underlying page state, the skill produces identical output. The webpart iteration order is the order they appear in the parsed JSON array; HTML entity decoding is deterministic; tag stripping uses a fixed regex. No randomness, no clock dependencies.

---

## Examples

### Example 1 — Happy path (URL input)

**Input:**
```
{ "pageUrl": "https://{your-tenant}.sharepoint.com/teams/{your-team-site}/SitePages/{your-page}.aspx" }
```

**Pipeline trace:**
- Phase 0: hostname ends in `.sharepoint.com` → no redirect → continue
- Phase 1: `getFileOrFolderMetadataByUrl` → returns id, driveId, webUrl, size: 124KB → size guard passes
- Phase 2: `readSmallTextFile` → returns ~120KB ASPX
- Phase 3: CanvasContent1 extracted, double-decoded, parses as JSON array of 7 webparts
- Phase 4: 5 webparts yield text (1 title, 4 text webparts), 2 are non-text (image + spacer)
- Phase 5: assembled output

**Output:**
```
{
  "text": "Quarterly Review Overview\n\nWhat this page covers...\n\nKey deadlines...\n\n...",
  "pageTitle": "Quarterly Review Overview",
  "webpartCount": 7,
  "extractedWebpartCount": 5,
  "warnings": [
    "Webpart 3 (type: imageGallery): no text-bearing fields found",
    "Webpart 6 (type: spacer): no text-bearing fields found"
  ],
  "error": null,
  "resolvedUrl": "https://{your-tenant}.sharepoint.com/teams/{your-team-site}/SitePages/{your-page}.aspx",
  "resolvedFileId": "01ABCDEF..."
}
```

### Example 2 — Redirect input

**Input:**
```
{ "pageUrl": "https://example.com/our-page" }
```

**Pipeline trace:**
- Phase 0.2: hostname `example.com` does NOT end in `.sharepoint.com` → flagged as redirect
- Phase 0.3: `web_fetch` follows redirect → final URL is `https://{your-tenant}.sharepoint.com/.../sitepages/our-page.aspx`
- Phases 1–5 proceed as Example 1

**Output:** Same shape as Example 1, with `resolvedUrl` set to the resolved SharePoint URL (not the original `example.com/our-page`).

### Example 3 — Empty content (no text webparts)

**Input:** A page that contains only an image gallery.

**Pipeline trace:**
- Phases 0–3 succeed; CanvasContent1 parses as JSON array of 3 image-gallery webparts
- Phase 4: all 3 webparts have neither `searchablePlainTexts`, `htmlTitle`, `innerHTML`, nor `data-sp-rte`
- `extractedCount == 0`, `webpartCount == 3`

**Output:**
```
{
  "text": "",
  "pageTitle": "Photo Gallery",
  "webpartCount": 3,
  "extractedWebpartCount": 0,
  "warnings": [
    "No text webparts found",
    "Webpart 1 (type: imageGallery): no text-bearing fields found",
    "Webpart 2 (type: imageGallery): no text-bearing fields found",
    "Webpart 3 (type: imageGallery): no text-bearing fields found"
  ],
  "error": null,
  "resolvedUrl": "...",
  "resolvedFileId": "..."
}
```

### Example 4 — Page over 5 MB

**Input:**
```
{ "pageUrl": "https://{your-tenant}.sharepoint.com/.../huge-page.aspx" }
```

**Pipeline trace:**
- Phase 1 metadata returns `size: 7,340,032` (7 MB)
- Size guard fires before Phase 2 ASPX read

**Output:**
```
{
  "text": "",
  "pageTitle": "",
  "webpartCount": 0,
  "extractedWebpartCount": 0,
  "warnings": [],
  "error": "Page exceeds the 5 MB read limit; use an alternative extraction path",
  "resolvedUrl": "https://{your-tenant}.sharepoint.com/.../huge-page.aspx",
  "resolvedFileId": "01ABCDEF..."
}
```

---

## Validation

**Motivating test case:** the {your-page}.aspx page in the {your-area-path} SitePages library — the original failing parse that motivated this skill. A successful run on {your-page}.aspx must produce:
- `text` containing the page's announcement copy (no raw ASPX, no JSON, no HTML tags)
- `pageTitle` populated (typically "Quarterly Review" or similar)
- `webpartCount >= 1` and `extractedWebpartCount >= 1`
- `error: null`

**Idempotency check:** Invoke the skill twice on the same URL in the same session. Compare the two `PageReadResult` outputs character-by-character. Any divergence indicates a defect — webpart ordering and decode behavior must be deterministic.

**Edge case coverage** (per SC-002, walked manually against this SKILL.md):

| Edge case | Phase | Expected behavior |
|---|---|---|
| Redirect URL (example.com) | 0.2 / 0.3 | Resolved via `web_fetch`; final SharePoint URL flows to Phase 1 |
| `CanvasContent1` absent | 3 | `warnings: ["No canvas content found"]`, `text: ""`, `error: null` |
| All webparts non-text | 4 | `warnings: ["No text webparts found", ...per-webpart]`, `text: ""`, `error: null` |
| Triple-encoded entities | 3.3 | Third decode pass applied; warning recorded |
| Page > 5 MB | 1 | `error: "Page exceeds the 5 MB read limit..."`, no read attempted |
| Site context ambiguity | 1 | Use `parentReference.driveId` from metadata; ignore URL path heuristics |
| Multi-language variants | 4 | Default variant extracted; `warnings` notes additional variants if detectable |

If any of these checks fails on a real SharePoint page, the defect is in this skill — not in the calling agent.
