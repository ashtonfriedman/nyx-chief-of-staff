# Co-Browser Browser Extension

This is a real Chromium browser extension for Edge or Chrome. It inspects the currently active browser tab and talks to the local `cobrowser` bridge running inside the Copilot extension.

## What It Solves

- Reads the currently active already-open tab
- Extracts visible text from that tab
- Scrolls the active tab before extraction when requested
- Captures a visible-tab screenshot
- Avoids the Playwright limitation where a normal already-open tab cannot be attached retroactively

## Load It In Edge

1. Open `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Choose this folder: `extensions/cobrowser/browser-extension`
5. Keep Edge open on the tab you want the bridge to inspect

The extension will poll `http://127.0.0.1:44777` by default, which is the local bridge started by the `cobrowser` Copilot extension.

## Notes

- The active tab is whatever tab is focused in the last-focused Edge or Chrome window.
- Internal browser pages such as `edge://` and `chrome://` cannot be inspected.
- If the local bridge is not running yet, the extension will keep retrying.

