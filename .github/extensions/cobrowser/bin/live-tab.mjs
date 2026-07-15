#!/usr/bin/env node
import { createBrowserExtensionBridge } from "../tools/browser-extension-bridge.mjs";

const DEFAULT_EXTENSION_DIR = new URL("../browser-extension/", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1");

function printUsage() {
  console.log(`Usage:
  node extensions/cobrowser/bin/live-tab.mjs status
  node extensions/cobrowser/bin/live-tab.mjs tabs [--include-internal]
  node extensions/cobrowser/bin/live-tab.mjs inspect [--url-contains TEXT] [--title-contains TEXT] [--max-text-chars N] [--json]
  node extensions/cobrowser/bin/live-tab.mjs navigate URL [--url-contains TEXT] [--wait-ms N]
  node extensions/cobrowser/bin/live-tab.mjs click (--text TEXT | --selector CSS) [--url-contains TEXT]
  node extensions/cobrowser/bin/live-tab.mjs scroll-down [--pixels N] [--url-contains TEXT]
  node extensions/cobrowser/bin/live-tab.mjs scroll-up [--pixels N] [--url-contains TEXT]
  node extensions/cobrowser/bin/live-tab.mjs reload|back|forward [--url-contains TEXT]

Options:
  --exact-url URL          Match a tab by exact URL
  --url-contains TEXT     Match a tab whose URL contains TEXT
  --title-contains TEXT   Match a tab whose title contains TEXT
  --match-index N         Zero-based match index when multiple tabs match
  --wait-ms N             Wait after control actions before reporting tab state
  --timeout-ms N          Bridge command timeout
  --json                  Print raw JSON
`);
}

function parseArgs(argv) {
  const [command, ...tokens] = argv;
  const options = {
    command,
    positional: [],
    exact_url: null,
    url_contains: null,
    title_contains: null,
    match_index: 0,
    include_internal_pages: false,
    max_text_chars: 2000,
    timeout_ms: 20000,
    wait_ms: 900,
    pixels: 0,
    json: false,
    selector: null,
    text: null,
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = () => {
      index += 1;
      if (index >= tokens.length) {
        throw new Error(`${token} requires a value.`);
      }
      return tokens[index];
    };

    switch (token) {
      case "--exact-url":
        options.exact_url = next();
        break;
      case "--url-contains":
        options.url_contains = next();
        break;
      case "--title-contains":
        options.title_contains = next();
        break;
      case "--match-index":
        options.match_index = Number(next());
        break;
      case "--include-internal":
        options.include_internal_pages = true;
        break;
      case "--max-text-chars":
        options.max_text_chars = Number(next());
        break;
      case "--timeout-ms":
        options.timeout_ms = Number(next());
        break;
      case "--wait-ms":
        options.wait_ms = Number(next());
        break;
      case "--pixels":
        options.pixels = Number(next());
        break;
      case "--selector":
        options.selector = next();
        break;
      case "--text":
        options.text = next();
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        options.command = "help";
        break;
      default:
        if (token.startsWith("--")) {
          throw new Error(`Unknown option: ${token}`);
        }
        options.positional.push(token);
        break;
    }
  }

  return options;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeTab(tab) {
  if (!tab) {
    return "(unknown tab)";
  }
  return `[${tab.windowId}:${tab.tabId}] ${tab.active ? "active" : "inactive"} | ${tab.title || "(no title)"} | ${tab.url || "(no URL)"}`;
}

function textPreview(text, maxLength = 1200) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
}

function tabMatchOptions(options) {
  return {
    exact_url: options.exact_url || null,
    url_contains: options.url_contains || null,
    title_contains: options.title_contains || null,
    match_index: Number.isInteger(options.match_index) ? options.match_index : 0,
    activate_match: true,
  };
}

function requiredCapability(command) {
  if (command === "tabs") {
    return "list-tabs";
  }
  if (command === "inspect") {
    return "inspect-tab";
  }
  if (["navigate", "click", "scroll-down", "scroll-up", "reload", "back", "forward"].includes(command)) {
    return "control-tab";
  }
  return null;
}

async function waitForClient(bridge, capability, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const instances = bridge.listInstances();
    const client = capability
      ? instances.find((instance) => Array.isArray(instance.capabilities) && instance.capabilities.includes(capability))
      : instances[0];
    if (client) {
      return client;
    }
    await delay(500);
  }
  const detail = capability ? ` with ${capability}` : "";
  throw new Error(`No live browser-extension client${detail} connected within ${timeoutMs}ms. Make sure the Edge extension is enabled and a normal page tab is open.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.command || options.command === "help") {
    printUsage();
    return;
  }

  const bridge = createBrowserExtensionBridge({
    port: 44777,
    extensionDir: DEFAULT_EXTENSION_DIR,
  });

  try {
    await bridge.ensureStarted();
    const capability = requiredCapability(options.command);
    const client = await waitForClient(bridge, capability, Number(options.timeout_ms || 20000));

    if (options.command === "status") {
      const status = {
        endpoint: bridge.bridgeEndpoint(),
        clients: bridge.listInstances(),
      };
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
      } else {
        console.log(`Bridge: ${status.endpoint}`);
        console.log(`Clients: ${status.clients.length}`);
        for (const instance of status.clients) {
          console.log(`- ${instance.instanceId}: ${instance.browserName} | ${(instance.capabilities || []).join(",")} | ${summarizeTab(instance.activeTab)}`);
        }
      }
      return;
    }

    if (options.command === "tabs") {
      const result = await bridge.runCommand("list-tabs", {
        include_internal_pages: options.include_internal_pages,
      }, { timeoutMs: Number(options.timeout_ms || 20000), instanceId: client.instanceId });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        for (const tab of result.tabs || []) {
          console.log(`- ${summarizeTab(tab)}`);
        }
      }
      return;
    }

    if (options.command === "inspect") {
      const result = await bridge.runCommand("inspect-tab", {
        ...tabMatchOptions(options),
        max_text_chars: Number(options.max_text_chars || 2000),
        capture_screenshot: false,
      }, { timeoutMs: Number(options.timeout_ms || 20000), instanceId: client.instanceId });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(summarizeTab(result.tab));
        console.log(textPreview(result.bodyText));
      }
      return;
    }

    const action = options.command;
    const payload = {
      ...tabMatchOptions(options),
      action,
      wait_ms: Number(options.wait_ms || 900),
      pixels: Number(options.pixels || 0),
      selector: options.selector || null,
      text: options.text || null,
      url: options.positional[0] || null,
    };

    if (action === "navigate" && !payload.url) {
      throw new Error("navigate requires a URL.");
    }
    if (action === "click" && !payload.selector && !payload.text) {
      throw new Error("click requires --selector or --text.");
    }

    const result = await bridge.runCommand("control-tab", payload, {
      timeoutMs: Number(options.timeout_ms || 20000),
      instanceId: client.instanceId,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Action: ${action}`);
      console.log(summarizeTab(result.tab));
      console.log(`Result: ${JSON.stringify(result.actionResult || null)}`);
    }
  } finally {
    await bridge.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});

