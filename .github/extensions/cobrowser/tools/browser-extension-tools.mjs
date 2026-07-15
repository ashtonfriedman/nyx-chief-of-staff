import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  ensureDir,
  nowStamp,
  previewText,
  resolveManagedPath,
  sessionFile,
  slugify,
  validateUrl,
  wrapUntrusted,
  writeJsonFile,
} from "./security-utils.mjs";

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error("Screenshot payload was not a valid base64 data URL.");
  }

  return {
    contentType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

export function createBrowserExtensionTools(sessionDir, bridge) {
  ensureDir(sessionDir);

  return [
    {
      name: "cobrowser_browserext_status",
      description: "Show whether the real browser extension bridge is connected and where to load the unpacked extension from.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const status = bridge.getStatus();
        return [
          "Browser extension bridge status.",
          `- Started: ${status.started ? "yes" : "no"}`,
          `- HTTP URL: ${status.httpUrl}`,
          `- WebSocket URL: ${status.websocketUrl}`,
          `- Extension path: ${status.browserExtensionDir}`,
          `- Connected clients: ${status.connectedClients.length}`,
          ...status.connectedClients.map((client) => `- Client ${client.instanceId}: ${client.browserName || "browser-extension"} | ${client.activeTab?.title || "(no active tab)"} | ${client.activeTab?.url || "(no URL)"}`),
          ...(status.startupError ? [`- Startup error: ${status.startupError}`] : []),
        ].join("\n");
      },
    },
    {
      name: "cobrowser_browserext_list_tabs",
      description: "List tabs visible to the real browser extension in the current browser session.",
      parameters: {
        type: "object",
        properties: {
          include_internal_pages: { type: "boolean", description: "Include browser-internal pages such as edge:// and chrome:// tabs." },
        },
      },
      handler: async (args) => {
        const result = await bridge.sendCommand("list-tabs", {
          include_internal_pages: args.include_internal_pages === true,
        }, {
          timeoutMs: 10000,
        });

        const tabs = Array.isArray(result.tabs) ? result.tabs : [];
        if (tabs.length === 0) {
          return "The browser extension did not report any tabs.";
        }

        return tabs
          .map((tab) => `- [${tab.windowId}:${tab.tabId}] ${tab.active ? "active" : "inactive"} | ${tab.title || "(no title)"} | ${tab.url || "(no URL)"}`)
          .join("\n");
      },
    },
    {
      name: "cobrowser_browserext_attach_tab",
      description: "Use the real Edge/Chrome browser extension to inspect an already-open tab, optionally activate it, scroll it, extract text, and capture a visible screenshot.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional session name for the browser-extension inspection." },
          exact_url: { type: "string", description: "Optional exact URL of the tab to inspect." },
          url_contains: { type: "string", description: "Optional substring used to find the tab URL." },
          title_contains: { type: "string", description: "Optional substring used to find the tab title." },
          match_index: { type: "number", description: "Optional zero-based index if multiple tabs match the filters." },
          activate_match: { type: "boolean", description: "Whether to focus and activate the matching tab before inspection. Defaults to true." },
          wait_for_selector: { type: "string", description: "Optional CSS selector to wait for in the page before reading it." },
          expected_text: { type: "string", description: "Optional text that should be present in the page body." },
          selector: { type: "string", description: "Optional CSS selector whose text should be captured separately." },
          timeout_ms: { type: "number", description: "Timeout for the browser-extension command. Defaults to 15000." },
          scroll_page_count: { type: "number", description: "Optional number of PageDown-style scroll steps to perform before extraction." },
          max_text_chars: { type: "number", description: "Maximum number of body-text characters to persist. Defaults to 12000." },
          capture_screenshot: { type: "boolean", description: "Whether to capture a visible screenshot. Defaults to true." },
          screenshot_path: { type: "string", description: "Optional absolute PNG output path inside data/sessions/." },
        },
      },
      handler: async (args) => {
        const name = args.name || `browserext-${slugify(args.url_contains || args.title_contains || args.exact_url || "active-tab")}`;
        const filePath = sessionFile(sessionDir, name);
        const evidenceDir = join(sessionDir, slugify(name));
        ensureDir(evidenceDir);

        const result = await bridge.sendCommand("inspect-tab", {
          exact_url: args.exact_url || null,
          url_contains: args.url_contains || null,
          title_contains: args.title_contains || null,
          match_index: Number.isInteger(args.match_index) ? args.match_index : 0,
          activate_match: args.activate_match !== false,
          wait_for_selector: args.wait_for_selector || null,
          expected_text: args.expected_text || null,
          selector: args.selector || null,
          scroll_page_count: Number(args.scroll_page_count || 0),
          max_text_chars: Number(args.max_text_chars || 12000),
          timeout_ms: Number(args.timeout_ms || 15000),
          capture_screenshot: args.capture_screenshot !== false,
        }, {
          timeoutMs: Number(args.timeout_ms || 15000) + 5000,
        });

        let screenshotPath = null;
        if (result.screenshotDataUrl && args.capture_screenshot !== false) {
          const screenshotResult = resolveManagedPath(
            sessionDir,
            args.screenshot_path,
            join(evidenceDir, `${slugify(name)}-${nowStamp()}.png`),
            {
              source: "cobrowser_browserext_attach_tab",
              detailKey: "screenshotPath",
              message: "screenshot_path must stay inside data/sessions/",
            },
          );
          if (!screenshotResult.ok) {
            return screenshotResult.reason;
          }

          screenshotPath = screenshotResult.resolvedPath;
          ensureDir(dirname(screenshotPath));
          const decoded = decodeDataUrl(result.screenshotDataUrl);
          writeFileSync(screenshotPath, decoded.buffer);
        }

        const wrappedBodyText = wrapUntrusted(result.bodyText || "");
        const wrappedSelectorText = result.selectorText ? wrapUntrusted(result.selectorText) : null;
        const wrappedSelectedText = result.selectedText ? wrapUntrusted(result.selectedText) : null;

        const session = {
          name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          mode: "browser-extension-tab",
          tab: result.tab || null,
          expectedText: args.expected_text || null,
          expectedTextPresent: result.expectedTextPresent ?? null,
          selector: args.selector || null,
          selectorFound: result.selectorFound ?? null,
          selectorText: wrappedSelectorText,
          selectedText: wrappedSelectedText,
          bodyText: wrappedBodyText,
          scrollPageCount: Number(args.scroll_page_count || 0),
          screenshotPath,
          bridgeClientId: result.clientInstanceId || null,
          checkpoints: [
            {
              recordedAt: new Date().toISOString(),
              status: "browser-extension-inspection-complete",
              observedUrl: result.tab?.url || null,
              title: result.tab?.title || null,
            },
          ],
        };

        writeJsonFile(filePath, session);

        return [
          "Co-browser browser-extension inspection completed.",
          "- Path: Browser extension attached tab",
          `- Session: ${name}`,
          `- Tab: ${result.tab ? `[${result.tab.windowId}:${result.tab.tabId}] ${result.tab.title || "(no title)"}` : "(unknown tab)"}`,
          `- URL: ${result.tab?.url || "(no URL)"}`,
          `- Selector: ${args.selector ? `${args.selector} (${result.selectorFound ? "found" : "not found"})` : "not requested"}`,
          `- Expected text: ${args.expected_text ? `${args.expected_text} (${result.expectedTextPresent ? "present" : "absent"})` : "not requested"}`,
          `- Scroll pages: ${Number(args.scroll_page_count || 0)}`,
          `- Text preview: ${previewText(wrappedBodyText)}`,
          `- Screenshot: ${screenshotPath || "not captured"}`,
          `- Session file: ${filePath}`,
        ].join("\n");
      },
    },
    {
      name: "cobrowser_browserext_control_tab",
      description: "Control an already-open Edge/Chrome tab through the real browser extension: scroll, click, reload, go back/forward, or navigate to a URL.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "Action to perform: scroll-down, scroll-up, click, reload, back, forward, or navigate." },
          exact_url: { type: "string", description: "Optional exact URL of the tab to control." },
          url_contains: { type: "string", description: "Optional substring used to find the tab URL." },
          title_contains: { type: "string", description: "Optional substring used to find the tab title." },
          match_index: { type: "number", description: "Optional zero-based index if multiple tabs match the filters." },
          activate_match: { type: "boolean", description: "Whether to focus and activate the matching tab before control. Defaults to true." },
          selector: { type: "string", description: "CSS selector for click actions." },
          text: { type: "string", description: "Visible text to click when no selector is provided." },
          pixels: { type: "number", description: "Pixel distance for scroll actions. Defaults to most of the viewport height." },
          url: { type: "string", description: "Destination URL for navigate actions." },
          wait_ms: { type: "number", description: "Milliseconds to wait after the action before reporting tab state. Defaults to 700." },
          timeout_ms: { type: "number", description: "Timeout for the browser-extension command. Defaults to 15000." },
        },
      },
      handler: async (args) => {
        const action = args.action || "scroll-down";
        let normalizedUrl = args.url || null;
        if (action === "navigate") {
          const urlValidation = validateUrl(args.url, { source: "cobrowser_browserext_control_tab" });
          if (!urlValidation.ok) {
            return urlValidation.reason;
          }
          normalizedUrl = urlValidation.normalizedUrl;
        }

        const result = await bridge.sendCommand("control-tab", {
          action,
          exact_url: args.exact_url || null,
          url_contains: args.url_contains || null,
          title_contains: args.title_contains || null,
          match_index: Number.isInteger(args.match_index) ? args.match_index : 0,
          activate_match: args.activate_match !== false,
          selector: args.selector || null,
          text: args.text || null,
          pixels: Number(args.pixels || 0),
          url: normalizedUrl,
          wait_ms: Number(args.wait_ms || 700),
        }, {
          timeoutMs: Number(args.timeout_ms || 15000),
        });

        return [
          "Co-browser browser-extension control completed.",
          `- Action: ${action}`,
          `- Tab: ${result.tab ? `[${result.tab.windowId}:${result.tab.tabId}] ${result.tab.title || "(no title)"}` : "(unknown tab)"}`,
          `- URL: ${result.tab?.url || "(no URL)"}`,
          `- Result: ${JSON.stringify(result.actionResult || null)}`,
        ].join("\n");
      },
    },
  ];
}
