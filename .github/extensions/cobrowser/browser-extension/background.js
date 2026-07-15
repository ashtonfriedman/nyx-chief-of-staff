import {
  BACKOFF_DELAYS,
  DEFAULT_BRIDGE_ENDPOINT,
  bootstrapBridgeAuth,
  logExtensionSecurityEvent,
  readBridgeToken,
  validateBridgeEndpoint,
  validateNavigationUrl,
} from "./security-utils.js";

const INSTANCE_ID_KEY = "cobrowserBridgeInstanceId";
const BRIDGE_ENDPOINT_KEY = "cobrowserBridgeEndpoint";
const IDLE_DELAY_MS = 750;
const MAX_FAILURE_DELAY_MS = 30000;
const INTERNAL_PAGE_URL_PATTERN = /^(edge|chrome):\/\//i;
const PRIVILEGED_MESSAGE_TYPES = new Set(["wakeBridge", "getStatus", "reconnectBridge", "setBridgeEndpoint"]);

let bridgeLoopPromise = null;
let activeInstanceId = null;
let lastError = null;
let isConnected = false;
let inMemoryToken = null;
let inMemoryEndpoint = DEFAULT_BRIDGE_ENDPOINT;

class HttpStatusError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpStatusError";
    this.status = status;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStorageValue(key, fallbackValue = null) {
  const payload = await chrome.storage.local.get(key);
  return payload[key] ?? fallbackValue;
}

async function setStorageValue(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

async function getOrCreateInstanceId() {
  const existing = await getStorageValue(INSTANCE_ID_KEY);
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  await setStorageValue(INSTANCE_ID_KEY, created);
  return created;
}

async function getBridgeEndpoint() {
  if (inMemoryEndpoint) {
    return inMemoryEndpoint;
  }

  return await getStorageValue(BRIDGE_ENDPOINT_KEY, DEFAULT_BRIDGE_ENDPOINT);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

function summarizeTab(tab) {
  if (!tab) {
    return null;
  }

  return {
    tabId: tab.id ?? null,
    windowId: tab.windowId ?? null,
    active: Boolean(tab.active),
    title: tab.title || null,
    url: tab.url || null,
    status: tab.status || null,
  };
}

function isTrustedRuntimeSender(sender) {
  return !sender?.id || sender.id === chrome.runtime.id;
}

async function loadBridgeTokenPayload() {
  return await readBridgeToken({
    fetchImpl: fetch,
    getRuntimeUrl: (path) => chrome.runtime.getURL(path),
    cacheBust: Date.now(),
  });
}

function validateBootstrapEndpoint(value, source = "bridge-token.json", eventType = "endpointRejected") {
  return validateBridgeEndpoint(value, {
    source,
    eventType,
    logger: logExtensionSecurityEvent,
  });
}

async function bootstrapToken() {
  try {
    const bootstrap = await bootstrapBridgeAuth({
      readBridgeTokenImpl: loadBridgeTokenPayload,
      validateBridgeEndpointImpl: (value, options = {}) => validateBootstrapEndpoint(value, options.source || "bridge-token.json"),
      delayImpl: delay,
      backoffDelays: BACKOFF_DELAYS,
    });

    inMemoryToken = bootstrap.token;
    inMemoryEndpoint = bootstrap.bridgeEndpoint;
    await setStorageValue(BRIDGE_ENDPOINT_KEY, bootstrap.bridgeEndpoint);
    lastError = null;
    return true;
  } catch (error) {
    inMemoryToken = null;
    inMemoryEndpoint = null;
    isConnected = false;
    lastError = String(error?.message || error);
    logExtensionSecurityEvent("bootstrapError", "bootstrapBridgeAuth", { reason: lastError });
    return false;
  }
}

async function rereadTokenAfter401() {
  try {
    const payload = await loadBridgeTokenPayload();
    const endpoint = validateBootstrapEndpoint(payload.bridgeEndpoint, "bridge-token.json-401-retry");
    if (!endpoint.ok) {
      throw new Error(endpoint.reason);
    }

    inMemoryToken = payload.token;
    inMemoryEndpoint = endpoint.normalizedEndpoint;
    await setStorageValue(BRIDGE_ENDPOINT_KEY, endpoint.normalizedEndpoint);
  } catch (error) {
    inMemoryToken = null;
    inMemoryEndpoint = null;
    const failure = new Error("Bootstrap failure: reread token after 401 also failed; no unauthenticated fallback");
    failure.cause = error;
    failure.fatalBootstrap = true;
    throw failure;
  }
}

async function fetchJson(url, payload, { allow401Retry = true } = {}) {
  if (!inMemoryToken) {
    throw new Error("Bridge token not yet bootstrapped");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Token": inMemoryToken,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    const error = new HttpStatusError(response.status, body.error || `HTTP ${response.status}`);
    if (allow401Retry && response.status === 401) {
      await rereadTokenAfter401();
      return await fetchJson(url, payload, { allow401Retry: false });
    }
    throw error;
  }

  return body;
}

function tabMatches(tab, payload = {}) {
  const url = String(tab.url || "");
  const title = String(tab.title || "");

  if (payload.exact_url && url !== payload.exact_url) {
    return false;
  }

  if (payload.url_contains && !url.includes(payload.url_contains)) {
    return false;
  }

  if (payload.title_contains && !title.toLowerCase().includes(String(payload.title_contains).toLowerCase())) {
    return false;
  }

  return true;
}

async function resolveTargetTab(payload = {}) {
  if (!payload.exact_url && !payload.url_contains && !payload.title_contains) {
    return await getActiveTab();
  }

  const tabs = await chrome.tabs.query({});
  const matches = tabs.filter((tab) => tabMatches(tab, payload));
  const matchIndex = Number.isInteger(payload.match_index) ? payload.match_index : 0;
  return matches[matchIndex] || null;
}

async function inspectTab(payload = {}) {
  let targetTab = await resolveTargetTab(payload);
  if (!targetTab?.id) {
    throw new Error("No matching browser tab was found.");
  }

  if (!targetTab.url || /^(edge|chrome):\/\//i.test(targetTab.url)) {
    throw new Error(`Unsupported tab URL: ${targetTab.url || "(unknown)"}`);
  }

  if (payload.activate_match !== false) {
    await chrome.windows.update(targetTab.windowId, { focused: true });
    await chrome.tabs.update(targetTab.id, { active: true });
    await delay(250);
    targetTab = await chrome.tabs.get(targetTab.id);
  }

  const waitForSelectorTimeoutMs = Math.max(0, Number(payload.timeout_ms || 15000));
  const maxTextChars = Math.max(250, Number(payload.max_text_chars || 12000));

  if (Number(payload.scroll_page_count || 0) > 0) {
    await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: async (scrollCount) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        for (let index = 0; index < scrollCount; index += 1) {
          // MAIN world required: pages that override scrolling APIs are most reliable here.
          window.scrollBy(0, Math.max(window.innerHeight * 0.85, 400));
          await sleep(200);
        }
      },
      args: [Number(payload.scroll_page_count || 0)],
      world: "MAIN", // FR-010 exception: scrolling is more reliable in the page's execution context.
    });
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    func: async (command) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const deadline = Date.now() + Math.max(0, Number(command.wait_for_selector_timeout_ms || 0));
      let selectorFound = null;
      let selectorText = null;

      if (command.wait_for_selector) {
        while (!document.querySelector(command.wait_for_selector) && Date.now() < deadline) {
          await sleep(150);
        }

        const waitedMatch = document.querySelector(command.wait_for_selector);
        selectorFound = Boolean(waitedMatch);
        selectorText = waitedMatch ? (waitedMatch.innerText || waitedMatch.textContent || "") : null;
      }

      if (command.selector && selectorText === null) {
        const selectorMatch = document.querySelector(command.selector);
        selectorFound = Boolean(selectorMatch);
        selectorText = selectorMatch ? (selectorMatch.innerText || selectorMatch.textContent || "") : null;
      }

      const bodyText = String(document.body?.innerText || "");
      return {
        bodyText: bodyText.slice(0, command.max_text_chars || 12000),
        selectedText: String(window.getSelection?.() || "") || null,
        selectorFound,
        selectorText,
        expectedTextPresent: command.expected_text ? bodyText.includes(command.expected_text) : null,
      };
    },
    args: [{
      wait_for_selector: payload.wait_for_selector || null,
      selector: payload.selector || null,
      expected_text: payload.expected_text || null,
      wait_for_selector_timeout_ms: waitForSelectorTimeoutMs,
      max_text_chars: maxTextChars,
    }],
    world: "ISOLATED", // FR-010: extraction runs in extension context, not the page's script context.
  });

  let screenshotDataUrl = null;
  if (payload.capture_screenshot !== false) {
    screenshotDataUrl = await chrome.tabs.captureVisibleTab(targetTab.windowId, { format: "png" });
  }

  const refreshedTab = await chrome.tabs.get(targetTab.id);
  return {
    clientInstanceId: activeInstanceId,
    tab: summarizeTab(refreshedTab),
    bodyText: result.bodyText || "",
    selectedText: result.selectedText || null,
    selectorFound: result.selectorFound ?? null,
    selectorText: result.selectorText || null,
    expectedTextPresent: result.expectedTextPresent ?? null,
    screenshotDataUrl,
  };
}

async function controlTab(payload = {}) {
  let targetTab = await resolveTargetTab(payload);
  if (!targetTab?.id) {
    throw new Error("No matching browser tab was found.");
  }

  const action = String(payload.action || "scroll-down").toLowerCase();

  if (payload.activate_match !== false) {
    await chrome.windows.update(targetTab.windowId, { focused: true });
    await chrome.tabs.update(targetTab.id, { active: true });
    await delay(150);
    targetTab = await chrome.tabs.get(targetTab.id);
  }

  let actionResult = null;
  if (action === "navigate") {
    if (!payload.url) {
      throw new Error("A url is required for navigate.");
    }

    const urlValidation = validateNavigationUrl(payload.url);
    if (!urlValidation.ok) {
      throw new Error(urlValidation.reason);
    }

    await chrome.tabs.update(targetTab.id, { url: urlValidation.normalizedUrl });
    actionResult = { action, url: urlValidation.normalizedUrl };
  } else if (action === "reload") {
    await chrome.tabs.reload(targetTab.id);
    actionResult = { action };
  } else {
    if (!targetTab.url || /^(edge|chrome):\/\//i.test(targetTab.url)) {
      throw new Error(`Unsupported tab URL: ${targetTab.url || "(unknown)"}`);
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: targetTab.id },
      func: async (command) => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const visibleText = (element) => String(element?.innerText || element?.textContent || element?.value || element?.getAttribute?.("aria-label") || element?.getAttribute?.("title") || "").trim();

        if (command.action === "back") {
          history.back();
          return { action: command.action };
        }

        if (command.action === "forward") {
          history.forward();
          return { action: command.action };
        }

        if (command.action === "scroll-up" || command.action === "scroll-down") {
          const direction = command.action === "scroll-up" ? -1 : 1;
          const pixels = Math.max(50, Number(command.pixels || window.innerHeight * 0.85));
          window.scrollBy(0, direction * pixels);
          await sleep(100);
          return { action: command.action, scrollX: window.scrollX, scrollY: window.scrollY };
        }

        if (command.action === "click") {
          let element = null;
          if (command.selector) {
            element = document.querySelector(command.selector);
          } else if (command.text) {
            const needle = String(command.text).trim().toLowerCase();
            const primaryCandidates = Array.from(document.querySelectorAll("a, button, [role='button'], [role='tab'], input[type='button'], input[type='submit'], summary"));
            const fallbackCandidates = Array.from(document.querySelectorAll("[tabindex]")).filter((candidate) => !primaryCandidates.includes(candidate));
            const candidates = [...primaryCandidates, ...fallbackCandidates]
              .map((candidate) => ({ candidate, text: visibleText(candidate) }))
              .filter((entry) => entry.text);
            const exact = candidates.filter((entry) => entry.text.toLowerCase() === needle);
            const starts = candidates.filter((entry) => entry.text.toLowerCase().startsWith(needle));
            const includes = candidates.filter((entry) => entry.text.toLowerCase().includes(needle));
            const best = [...exact, ...starts, ...includes].sort((left, right) => left.text.length - right.text.length)[0];
            element = best?.candidate || null;
          }

          if (!element) {
            return { action: command.action, clicked: false, selector: command.selector || null, text: command.text || null };
          }

          element.scrollIntoView({ block: "center", inline: "center" });
          await sleep(100);
          element.click();
          return {
            action: command.action,
            clicked: true,
            tagName: element.tagName,
            text: visibleText(element).slice(0, 200),
          };
        }

        throw new Error(`Unsupported control action '${command.action}'.`);
      },
      args: [{
        action,
        selector: payload.selector || null,
        text: payload.text || null,
        pixels: Number(payload.pixels || 0),
      }],
      world: "MAIN", // FR-011: DOM interaction and history control must run in the page context.
    });
    actionResult = result;
  }

  await delay(Math.max(0, Number(payload.wait_ms || 700)));
  const refreshedTab = await chrome.tabs.get(targetTab.id).catch(() => targetTab);
  return {
    clientInstanceId: activeInstanceId,
    tab: summarizeTab(refreshedTab),
    actionResult,
  };
}

async function executeCommand(commandType, payload = {}) {
  switch (commandType) {
    case "list-tabs": {
      const tabs = await chrome.tabs.query({});
      const includeInternalPages = payload.include_internal_pages === true;
      return {
        tabs: tabs
          .filter((tab) => includeInternalPages || !INTERNAL_PAGE_URL_PATTERN.test(String(tab.url || "")))
          .map(summarizeTab),
      };
    }
    case "inspect-tab":
      return await inspectTab(payload);
    case "control-tab":
      return await controlTab(payload);
    default:
      throw new Error(`Unsupported bridge command '${commandType}'.`);
  }
}

function ensureWakeAlarm() {
  if (!chrome.alarms) {
    return;
  }
  chrome.alarms.create("cobrowser-bridge-wake", { periodInMinutes: 1 });
}

async function runBridgeLoop() {
  if (bridgeLoopPromise) {
    return bridgeLoopPromise;
  }

  bridgeLoopPromise = (async () => {
    if (!(await bootstrapToken())) {
      return;
    }

    let consecutiveFailures = 0;
    activeInstanceId = await getOrCreateInstanceId();

    while (true) {
      try {
        const endpoint = await getBridgeEndpoint();
        const activeTab = summarizeTab(await getActiveTab().catch(() => null));
        const manifest = chrome.runtime.getManifest();

        const poll = await fetchJson(`${endpoint}/api/poll`, {
          instanceId: activeInstanceId,
          browserName: navigator.userAgent.includes("Edg/") ? "msedge-browser-extension" : "chromium-browser-extension",
          extensionVersion: manifest.version,
          capabilities: ["inspect-tab", "list-tabs", "control-tab"],
          activeTab,
        });

        isConnected = true;
        lastError = null;
        consecutiveFailures = 0;

        if (poll.command) {
          try {
            const result = await executeCommand(poll.command.type, poll.command.payload || {});
            await fetchJson(`${endpoint}/api/result`, {
              instanceId: activeInstanceId,
              commandId: poll.command.id,
              ok: true,
              result,
              activeTab: summarizeTab(await getActiveTab().catch(() => null)),
            });
          } catch (error) {
            await fetchJson(`${endpoint}/api/result`, {
              instanceId: activeInstanceId,
              commandId: poll.command.id,
              ok: false,
              error: String(error?.message || error),
              activeTab: summarizeTab(await getActiveTab().catch(() => null)),
            });
          }
        }
      } catch (error) {
        isConnected = false;
        lastError = String(error?.message || error);
        consecutiveFailures += 1;

        if (error?.fatalBootstrap) {
          return;
        }
      }

      const delayMs = consecutiveFailures === 0
        ? IDLE_DELAY_MS
        : Math.min(IDLE_DELAY_MS * (2 ** consecutiveFailures), MAX_FAILURE_DELAY_MS);

      await delay(delayMs);
    }
  })().finally(() => {
    bridgeLoopPromise = null;
  });

  return bridgeLoopPromise;
}

chrome.runtime.onInstalled.addListener(() => {
  ensureWakeAlarm();
  void runBridgeLoop();
});

chrome.runtime.onStartup.addListener(() => {
  ensureWakeAlarm();
  void runBridgeLoop();
});

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "cobrowser-bridge-wake") {
      void runBridgeLoop();
    }
  });
}

chrome.tabs.onActivated.addListener(() => {
  void runBridgeLoop();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    void runBridgeLoop();
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  void runBridgeLoop();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (PRIVILEGED_MESSAGE_TYPES.has(message?.type) && !isTrustedRuntimeSender(sender)) {
    sendResponse({ ok: false, error: "Unauthorized sender" });
    return false;
  }

  if (message?.type === "wakeBridge") {
    void runBridgeLoop();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "getStatus") {
    Promise.all([getBridgeEndpoint(), getActiveTab().catch(() => null)])
      .then(([endpoint, activeTab]) => {
        sendResponse({
          connected: isConnected,
          bridgeEndpoint: endpoint,
          instanceId: activeInstanceId,
          lastError,
          activeTab: summarizeTab(activeTab),
        });
      })
      .catch(async () => {
        const endpoint = await getBridgeEndpoint();
        sendResponse({
          connected: false,
          bridgeEndpoint: endpoint,
          instanceId: activeInstanceId,
          lastError,
          activeTab: null,
        });
      });
    return true;
  }

  if (message?.type === "reconnectBridge") {
    void runBridgeLoop();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "setBridgeEndpoint") {
    const endpointValidation = validateBridgeEndpoint(message.bridgeEndpoint, {
      source: "popup-setBridgeEndpoint",
      eventType: "popupEndpointRejected",
      logger: logExtensionSecurityEvent,
    });
    if (!endpointValidation.ok) {
      sendResponse({ ok: false, error: endpointValidation.reason });
      return false;
    }

    chrome.storage.local.set({ [BRIDGE_ENDPOINT_KEY]: endpointValidation.normalizedEndpoint }).then(() => {
      inMemoryEndpoint = endpointValidation.normalizedEndpoint;
      void runBridgeLoop();
      sendResponse({ ok: true });
    });
    return true;
  }

  return false;
});

ensureWakeAlarm();
void runBridgeLoop();
