# Co-Browser Extension

A Copilot CLI extension that gives browser-oriented skills a real execution surface across three modes: fresh-context Playwright inspection, debug-enabled visible-tab attachment, and a real Edge or Chrome browser extension for already-open normal tabs.

## Setup

Install the extension's npm dependency:

```bash
cd extensions/cobrowser && npm install --no-fund --no-audit
```

This extension uses `playwright-core`, not the full `playwright` package, so it does not download browser binaries. It launches an existing local Edge or Chrome install instead.

## What It Provides

| Tool | Description |
|------|-------------|
| `cobrowser_open_tab` | Open a URL in the browser and create a durable guided-session record |
| `cobrowser_launch_debug_edge` | Launch a fresh debug-enabled Edge window so Playwright can attach to its tabs afterward |
| `cobrowser_attach_tab` | Attach Playwright to an existing debug-enabled Edge or Chrome tab via CDP, extract text, scroll, and capture evidence |
| `cobrowser_probe` | Run a one-shot Playwright inspection against a URL and capture evidence |
| `cobrowser_checkpoint` | Record a manual step, blocker, or observed state in an existing session |
| `cobrowser_capture_screenshot` | Capture the active browser window or full screen during a guided session and save it as checkpoint evidence |
| `cobrowser_browserext_status` | Report the local HTTP bridge URL and the connected real browser-extension clients |
| `cobrowser_browserext_list_tabs` | List tabs visible to the real browser extension in the current normal browser session |
| `cobrowser_browserext_attach_tab` | Inspect an already-open normal Edge or Chrome tab through the real browser extension, optionally scroll it, extract text, and capture a screenshot |
| `cobrowser_browserext_control_tab` | Control an already-open normal Edge or Chrome tab through the real browser extension |
| `cobrowser_list_sessions` | List saved sessions and their latest state |
| `cobrowser_clear_session` | Remove a saved session and its evidence folder |

## How It Works

1. `cobrowser_probe` is the fastest path when a fresh browser context is acceptable.
2. `cobrowser_launch_debug_edge` followed by `cobrowser_attach_tab` is the Playwright path for a visible tab that must stay on screen and is allowed to start in a fresh debug-enabled browser.
3. The real browser-extension path is for a normal already-open Edge or Chrome tab that Playwright cannot retroactively attach to. Load the unpacked extension from `extensions/cobrowser/browser-extension`, let it bootstrap from `browser-extension/bridge-token.json`, connect to `http://127.0.0.1:44777`, then use `cobrowser_browserext_list_tabs` or `cobrowser_browserext_attach_tab`.
4. `cobrowser_open_tab`, `cobrowser_checkpoint`, and `cobrowser_capture_screenshot` remain the guided-session path for login, MFA, approvals, or any manual boundary.
5. Session JSON and evidence files are stored under `extensions/cobrowser/data/sessions/`.

## Security Hardening Notes

- Browser navigation accepts only absolute `http:` and `https:` URLs.
- Extracted page text is stored as untrusted data with explicit marker wrappers.
- The browser-extension bridge uses a startup token written only to `browser-extension/bridge-token.json` for unpacked-extension bootstrap; the file is gitignored and deleted on shutdown on a best-effort basis.
- The browser extension service worker fetches the bridge through the explicit `http://127.0.0.1:44777/*` `host_permissions` entry. Do **not** restore `Access-Control-Allow-Origin` headers on bridge responses to troubleshoot connectivity; verify this permission instead.

## Enterprise Flow Notes

- Treat login, MFA, privileged approvals, and destructive actions as manual boundaries unless the user explicitly wants automation there.
- Use `cobrowser_open_tab` before asking the user to authenticate manually.
- After the user completes a manual step, use `cobrowser_checkpoint` to preserve the exact observed URL, state, and error text.
- When the user reaches a meaningful state in a guided session, use `cobrowser_capture_screenshot` after asking them to focus the relevant browser window.
- When the user wants Playwright to control a visible tab, use `cobrowser_launch_debug_edge` first and then `cobrowser_attach_tab` against that debug port.
- When the user wants an already-open normal tab inspected without relaunching the browser, use the unpacked browser extension path instead of pretending CDP attach will work.
- Use `cobrowser_probe` for read-only validation and evidence capture where launching a fresh browser context is sufficient.

## File Structure

```
extensions/cobrowser/
├── browser-extension/
├── extension.mjs
├── tools/
│   ├── browser-extension-bridge.mjs
│   ├── browser-extension-tools.mjs
│   └── cobrowser-tools.mjs
├── data/
│   ├── .gitkeep
│   └── sessions/
│       └── .gitkeep
├── package.json
└── README.md
```
## Handoff To Another Session

Use this README as the handoff surface when another session needs to update or operate the live browser path. It captures the unpacked extension path, bridge protocol, supported CLI commands, validation commands, and the traps that already cost time.

The short version: load `extensions/cobrowser/browser-extension` into the user's actual Edge or Chrome profile, validate with `npm run live-tab -- status`, and use `bin/live-tab.mjs` or `cobrowser_browserext_*` for normal already-open tabs. Do not revive the old WebSocket bridge or create one-off temp navigation harnesses.

## Live Tab CLI

Use `bin/live-tab.mjs` to control the already-running Edge or Chrome tab through the loaded browser extension without writing one-off harness scripts.

```bash
node extensions/cobrowser/bin/live-tab.mjs status
node extensions/cobrowser/bin/live-tab.mjs tabs
node extensions/cobrowser/bin/live-tab.mjs inspect --url-contains "pullrequest/10000001"
node extensions/cobrowser/bin/live-tab.mjs navigate "https://dev.azure.com/{your-org}/{your-project}/_git/{your-repo}/pullrequest/10000001?_a=files"
node extensions/cobrowser/bin/live-tab.mjs back
node extensions/cobrowser/bin/live-tab.mjs forward
node extensions/cobrowser/bin/live-tab.mjs click --text "Approve"
```

For Azure DevOps PR sub-tabs, prefer direct subview URLs such as `?_a=files` and `?_a=updates`; the global Repos navigation also has a `Files` link, so text-clicking `Files` can select the wrong control.
