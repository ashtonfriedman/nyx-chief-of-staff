import assert from "node:assert/strict";
import { createConnection, createServer as createNetServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createBrowserExtensionBridge } from "../tools/browser-extension-bridge.mjs";
import { logSecurityEvent, sanitizeUrlForLog } from "../tools/security-log.mjs";
import {
  resolveManagedPath,
  UNTRUSTED_END,
  UNTRUSTED_START,
  validateCaptureMode,
  validateCdpEndpoint,
  validateSessionNameComponent,
  validateUrl,
  wrapUntrusted,
} from "../tools/security-utils.mjs";
import {
  BACKOFF_DELAYS,
  DEFAULT_BRIDGE_ENDPOINT,
  bootstrapBridgeAuth,
  validateBridgeEndpoint,
} from "../browser-extension/security-utils.js";
import { createBrowserExtensionTools as createForkBrowserExtensionTools } from "../tools/browser-extension-tools.mjs";
import { createCobrowserTools as createForkCobrowserTools } from "../tools/cobrowser-tools.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(__dirname, "..");
const runtimeRoot = resolve(__dirname, "runtime");
const expectedToolSurface = [
  { name: "cobrowser_attach_tab", required: [] },
  { name: "cobrowser_browserext_attach_tab", required: [] },
  { name: "cobrowser_browserext_control_tab", required: [] },
  { name: "cobrowser_browserext_list_tabs", required: [] },
  { name: "cobrowser_browserext_status", required: [] },
  { name: "cobrowser_capture_screenshot", required: ["name", "state_summary", "step"] },
  { name: "cobrowser_checkpoint", required: ["name", "state_summary", "step"] },
  { name: "cobrowser_clear_session", required: ["name"] },
  { name: "cobrowser_launch_debug_edge", required: ["url"] },
  { name: "cobrowser_list_sessions", required: [] },
  { name: "cobrowser_open_tab", required: ["name", "url"] },
  { name: "cobrowser_probe", required: ["url"] },
].sort((left, right) => left.name.localeCompare(right.name));

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(runtimeRoot, { recursive: true });
after(() => rmSync(runtimeRoot, { recursive: true, force: true }));

function makeWorkspace(name) {
  const workspace = join(runtimeRoot, `${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function createStubBridge() {
  return {
    getStatus() {
      return {
        started: true,
        httpUrl: "http://127.0.0.1:44777",
        websocketUrl: null,
        browserExtensionDir: extensionRoot,
        startupError: null,
        connectedClients: [],
      };
    },
    async sendCommand() {
      throw new Error("sendCommand should not be called during surface tests");
    },
  };
}

function normalizeSurface(tools) {
  return tools
    .map((tool) => ({
      name: tool.name,
      required: [...(tool.parameters?.required || [])].sort(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function getFreePort() {
  const server = createNetServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });

  assert.ok(port, "expected a free TCP port");
  return port;
}

function createEventStub() {
  return {
    addListener() {},
  };
}

function createChromeStub() {
  const storage = new Map();
  return {
    storage,
    chrome: {
      runtime: {
        id: "test-extension-id",
        getURL: (path) => `chrome-extension://test-extension/${path}`,
        getManifest: () => ({ version: "0.0.0-test" }),
        onInstalled: createEventStub(),
        onStartup: createEventStub(),
        onMessage: createEventStub(),
      },
      alarms: {
        create() {},
        onAlarm: createEventStub(),
      },
      storage: {
        local: {
          async get(key) {
            if (typeof key === "string") {
              return { [key]: storage.get(key) ?? null };
            }
            return Object.fromEntries(storage.entries());
          },
          async set(values) {
            for (const [key, value] of Object.entries(values || {})) {
              storage.set(key, value);
            }
          },
        },
      },
      tabs: {
        onActivated: createEventStub(),
        onUpdated: createEventStub(),
        async query() {
          return [];
        },
        async update() {
          return {};
        },
        async get() {
          return null;
        },
        async reload() {},
        async captureVisibleTab() {
          return null;
        },
      },
      windows: {
        onFocusChanged: createEventStub(),
        async update() {
          return {};
        },
      },
      scripting: {
        async executeScript() {
          return [{ result: {} }];
        },
      },
    },
  };
}

async function loadBackgroundHarness(workspace, fetchImpl) {
  const harnessDir = join(workspace, "background-harness");
  mkdirSync(harnessDir, { recursive: true });

  const securityUtilsPath = join(harnessDir, "security-utils.js");
  writeFileSync(
    securityUtilsPath,
    `export * from ${JSON.stringify(pathToFileURL(resolve(extensionRoot, "browser-extension", "security-utils.js")).href)};\n`,
    "utf-8",
  );

  const backgroundHarnessPath = join(harnessDir, `background-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.mjs`);
  const backgroundSource = readFileSync(resolve(extensionRoot, "browser-extension", "background.js"), "utf-8")
    .replace(/\nchrome\.runtime\.onInstalled\.addListener\([\s\S]*$/, "\n")
    .concat("\nexport { bootstrapToken, fetchJson, rereadTokenAfter401 };\n");
  writeFileSync(backgroundHarnessPath, backgroundSource, "utf-8");

  const previousChrome = globalThis.chrome;
  const previousFetch = globalThis.fetch;
  const { chrome } = createChromeStub();
  globalThis.chrome = chrome;
  globalThis.fetch = fetchImpl;

  try {
    const module = await import(`${pathToFileURL(backgroundHarnessPath).href}?t=${Date.now()}`);
    return {
      module,
      restore() {
        if (previousChrome === undefined) {
          delete globalThis.chrome;
        } else {
          globalThis.chrome = previousChrome;
        }

        if (previousFetch === undefined) {
          delete globalThis.fetch;
        } else {
          globalThis.fetch = previousFetch;
        }
      },
    };
  } catch (error) {
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
    if (previousFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previousFetch;
    }
    throw error;
  }
}

test("security utils validate URL, endpoint, path, and untrusted wrapping", () => {
  assert.deepEqual(validateUrl("https://example.com/path?q=1"), {
    ok: true,
    normalizedUrl: "https://example.com/path?q=1",
  });
  assert.equal(validateUrl("javascript:alert(1)").ok, false);
  assert.equal(validateUrl("--load-extension=C:\\evil").ok, false);
  assert.equal(validateUrl("file:///C:/Windows/System32/drivers/etc/hosts").ok, false);

  assert.deepEqual(validateCdpEndpoint("http://127.0.0.1:9222"), {
    ok: true,
    normalizedEndpoint: "http://127.0.0.1:9222",
  });
  assert.equal(validateCdpEndpoint("https://127.0.0.1:9222").ok, false);
  assert.equal(validateCdpEndpoint("http://169.254.169.254").ok, false);
  assert.equal(validateCdpEndpoint("http://127.0.0.1:9222/json/version").ok, false);

  assert.equal(validateSessionNameComponent("portal-login").ok, true);
  assert.equal(validateSessionNameComponent("..\\evil").ok, false);
  assert.equal(validateCaptureMode("screen").ok, true);
  assert.equal(validateCaptureMode("printer").ok, false);

  const wrapped = wrapUntrusted(`alpha ${UNTRUSTED_END} omega`);
  assert.ok(wrapped.startsWith(`${UNTRUSTED_START}\n`));
  assert.ok(wrapped.endsWith(`\n${UNTRUSTED_END}`));
  assert.equal(wrapped.split(UNTRUSTED_END).length - 1, 1, "page content must not close the wrapper early");
  assert.ok(wrapped.includes("[·END UNTRUSTED WEB CONTENT]"), "escaped end marker should remain visibly distinct");

  const managedRoot = makeWorkspace("managed-root");
  const allowed = resolveManagedPath(managedRoot, join(managedRoot, "nested", "capture.png"), join(managedRoot, "default.png"));
  assert.equal(allowed.ok, true);
  assert.ok(String(allowed.resolvedPath).startsWith(managedRoot));

  const rejected = resolveManagedPath(managedRoot, resolve(managedRoot, "..", "..", "outside.png"), join(managedRoot, "default.png"));
  assert.equal(rejected.ok, false);
});

test("wrapUntrusted handles multiple and recursive end-marker edge cases", () => {
  const escapedMarker = "[·END UNTRUSTED WEB CONTENT]";
  const wrapped = wrapUntrusted(`${UNTRUSTED_END} middle ${UNTRUSTED_END} tail ${escapedMarker}`);

  assert.equal(wrapped.split(UNTRUSTED_END).length - 1, 1, "only the outer end marker should remain literal");
  assert.equal(wrapped.split(escapedMarker).length - 1, 3, "each literal end marker should become the visible escaped marker");

  const roundTripped = JSON.parse(JSON.stringify({ bodyText: wrapped }));
  assert.equal(roundTripped.bodyText.split(UNTRUSTED_END).length - 1, 1, "JSON serialization must not restore the literal end marker");
});

test("security log sanitizes sensitive fields and rotates oversized files", () => {
  const workspace = makeWorkspace("log");
  const logPath = join(workspace, "cobrowser-security.log");

  assert.equal(
    sanitizeUrlForLog("https://example.com/path?q=secret#frag"),
    "https://example.com/path",
  );

  writeFileSync(logPath, "x".repeat((10 * 1024 * 1024) + 1), "utf-8");
  logSecurityEvent(
    "urlRejected",
    "unit-test",
    {
      url: "https://example.com/path?q=secret#frag",
      token: "top-secret",
      headers: { authorization: "bearer token" },
      body: "do not log me",
      nested: { endpoint: "http://127.0.0.1:44777/path?token=secret#frag" },
    },
    logPath,
  );

  assert.ok(existsSync(`${logPath}.1`), "oversized log should rotate to .1");
  const entry = JSON.parse(readFileSync(logPath, "utf-8").trim());
  assert.equal(entry.eventType, "urlRejected");
  assert.equal(entry.source, "unit-test");
  assert.equal(entry.detail.url, "https://example.com/path");
  assert.equal("token" in entry.detail, false);
  assert.equal("headers" in entry.detail, false);
  assert.equal("body" in entry.detail, false);
  assert.equal(entry.detail.nested.endpoint, "http://127.0.0.1:44777/path");
});

test("browser-extension bootstrap helper retries with bounded backoff and validates endpoint", async () => {
  const delays = [];
  let attempts = 0;

  const bootstrapped = await bootstrapBridgeAuth({
    readBridgeTokenImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("bridge-token.json not found");
      }
      return {
        token: "bridge-token",
        generatedAt: "2026-05-22T00:00:00.000Z",
        bridgeEndpoint: DEFAULT_BRIDGE_ENDPOINT,
      };
    },
    validateBridgeEndpointImpl: (value, options = {}) => validateBridgeEndpoint(value, { ...options, logger: () => {} }),
    delayImpl: async (ms) => delays.push(ms),
    backoffDelays: BACKOFF_DELAYS,
  });

  assert.equal(bootstrapped.token, "bridge-token");
  assert.equal(bootstrapped.bridgeEndpoint, DEFAULT_BRIDGE_ENDPOINT);
  assert.deepEqual(delays, [100, 200]);

  assert.deepEqual(
    validateBridgeEndpoint(DEFAULT_BRIDGE_ENDPOINT, { logger: () => {} }),
    { ok: true, normalizedEndpoint: DEFAULT_BRIDGE_ENDPOINT },
  );
  assert.equal(validateBridgeEndpoint("http://localhost:44777", { logger: () => {} }).ok, false);
  assert.equal(validateBridgeEndpoint("http://127.0.0.1:9999", { logger: () => {} }).ok, false);

  await assert.rejects(
    () => bootstrapBridgeAuth({
      readBridgeTokenImpl: async () => ({ token: "bridge-token", bridgeEndpoint: "http://localhost:44777" }),
      validateBridgeEndpointImpl: (value, options = {}) => validateBridgeEndpoint(value, { ...options, logger: () => {} }),
      delayImpl: async () => {},
      backoffDelays: [1],
    }),
    /Hostname must be 127\.0\.0\.1/,
  );
});

test("background 401 recovery rereads the bridge token once and retries without fallback", async () => {
  const workspace = makeWorkspace("background-401");

  let bootstrapReads = 0;
  const successfulApiTokens = [];
  const successFetch = async (url, options = {}) => {
    if (String(url).startsWith("chrome-extension://")) {
      bootstrapReads += 1;
      return Response.json({
        token: bootstrapReads === 1 ? "initial-token" : "rotated-token",
        bridgeEndpoint: DEFAULT_BRIDGE_ENDPOINT,
      }, { status: 200 });
    }

    successfulApiTokens.push(options.headers?.["X-Bridge-Token"] || null);
    if (successfulApiTokens.length === 1) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ ok: true, command: null }, { status: 200 });
  };

  const successHarness = await loadBackgroundHarness(workspace, successFetch);
  try {
    assert.equal(await successHarness.module.bootstrapToken(), true);
    const pollResponse = await successHarness.module.fetchJson(`${DEFAULT_BRIDGE_ENDPOINT}/api/poll`, { instanceId: "client-1" });
    assert.deepEqual(pollResponse, { ok: true, command: null });
    assert.equal(bootstrapReads, 2, "401 recovery should reread bridge-token.json exactly once");
    assert.deepEqual(successfulApiTokens, ["initial-token", "rotated-token"]);
  } finally {
    successHarness.restore();
  }

  let failureReads = 0;
  const failedApiTokens = [];
  const failureFetch = async (url, options = {}) => {
    if (String(url).startsWith("chrome-extension://")) {
      failureReads += 1;
      return Response.json({
        token: failureReads === 1 ? "initial-token" : "rotated-token",
        bridgeEndpoint: DEFAULT_BRIDGE_ENDPOINT,
      }, { status: 200 });
    }

    failedApiTokens.push(options.headers?.["X-Bridge-Token"] || null);
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  };

  const failureHarness = await loadBackgroundHarness(workspace, failureFetch);
  try {
    assert.equal(await failureHarness.module.bootstrapToken(), true);
    await assert.rejects(
      () => failureHarness.module.fetchJson(`${DEFAULT_BRIDGE_ENDPOINT}/api/poll`, { instanceId: "client-2" }),
      /Unauthorized/,
    );
    assert.equal(failureReads, 2, "401 recovery should not reread more than once");
    assert.deepEqual(failedApiTokens, ["initial-token", "rotated-token"], "no unauthenticated fallback or third retry is allowed");
  } finally {
    failureHarness.restore();
  }
});

test("browser-extension bridge enforces auth, omits ACAO, and limits body size", async () => {
  const workspace = makeWorkspace("bridge");
  const extensionDir = join(workspace, "browser-extension");
  mkdirSync(extensionDir, { recursive: true });

  const port = await getFreePort();
  const bridge = createBrowserExtensionBridge({
    host: "127.0.0.1",
    port,
    extensionDir,
    pollHoldMs: 25,
    commandTimeoutMs: 100,
  });

  const endpoint = `http://127.0.0.1:${port}`;
  const tokenPath = join(extensionDir, "bridge-token.json");

  try {
    await bridge.ensureStarted();
    assert.ok(existsSync(tokenPath), "bridge bootstrap file should exist after startup");

    const tokenPayload = JSON.parse(readFileSync(tokenPath, "utf-8"));
    assert.equal(tokenPayload.bridgeEndpoint, endpoint);
    assert.ok(typeof tokenPayload.token === "string" && tokenPayload.token.length >= 64);

    let response = await fetch(`${endpoint}/api/health`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const unauthorizedHealth = await response.json();
    assert.deepEqual(unauthorizedHealth, { ok: false, error: "Unauthorized" });
    assert.equal(JSON.stringify(unauthorizedHealth).includes(tokenPayload.token), false);
    assert.equal(bridge.listInstances().length, 0);

    response = await fetch(`${endpoint}/api/health`, {
      headers: { "X-Bridge-Token": tokenPayload.token },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    const authorizedHealth = await response.json();
    assert.equal(authorizedHealth.ok, true);
    assert.equal(authorizedHealth.instanceCount, 0);

    response = await fetch(`${endpoint}/api/poll`, { method: "OPTIONS" });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), null);

    response = await fetch(`${endpoint}/api/anything`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: "Not found." });

    response = await fetch(`${endpoint}/api/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instanceId: "unauthorized-client" }),
    });
    assert.equal(response.status, 401);
    assert.equal(bridge.listInstances().length, 0);

    response = await fetch(`${endpoint}/api/poll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bridge-Token": tokenPayload.token,
      },
      body: JSON.stringify({ instanceId: "client-1", browserName: "test-browser" }),
    });
    assert.equal(response.status, 200);
    const poll = await response.json();
    assert.equal(poll.ok, true);
    assert.equal(bridge.listInstances().length, 1);

    const rawSocketResult = await new Promise((resolvePromise, rejectPromise) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      const chunks = [];
      let closeReason = null;
      const declaredBodyBytes = 2 * 1024 * 1024;
      const partialChunk = Buffer.from(`{"instanceId":"client-raw","pad":"${"a".repeat(8192)}`);
      let interval = null;
      let timeout = null;
      let settled = false;
      let bytesAttempted = 0;

      const finish = (result, isError = false) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        if (interval) {
          clearInterval(interval);
        }
        socket.removeAllListeners();
        if (!socket.destroyed) {
          socket.destroy();
        }
        const payload = {
          ...result,
          responseText: Buffer.concat(chunks).toString("utf-8"),
          bytesAttempted,
        };
        if (isError) {
          rejectPromise(result.error || new Error("bridge did not close oversized request socket"));
          return;
        }
        resolvePromise(payload);
      };

      socket.on("connect", () => {
        socket.write(
          [
            "POST /api/poll HTTP/1.1",
            `Host: 127.0.0.1:${port}`,
            "Content-Type: application/json",
            `X-Bridge-Token: ${tokenPayload.token}`,
            `Content-Length: ${declaredBodyBytes}`,
            "",
            "",
          ].join("\r\n"),
        );
        bytesAttempted += partialChunk.length;
        socket.write(partialChunk);

        interval = setInterval(() => {
          if (socket.destroyed) {
            return;
          }
          const nextChunk = Buffer.alloc(65536, 0x61);
          bytesAttempted += nextChunk.length;
          socket.write(nextChunk);
        }, 25);
      });

      socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      socket.on("close", (hadError) => {
        closeReason = hadError ? "error-close" : "close";
        finish({ closeReason });
      });
      socket.on("error", (error) => {
        closeReason = error.code || error.message;
        finish({ closeReason });
      });

      timeout = setTimeout(() => {
        finish({ error: new Error("bridge did not close oversized request socket") }, true);
      }, 3000);
    });

    assert.equal(rawSocketResult.responseText.includes("413"), true, "oversized request should still surface HTTP 413");
    assert.equal(rawSocketResult.bytesAttempted < (2 * 1024 * 1024), true, "bridge should close the socket before the declared body is fully sent");
  } finally {
    await bridge.close().catch(() => {});
  }

  assert.equal(existsSync(tokenPath), false, "bridge bootstrap file should be deleted on close");
});

test("tool handlers reject malicious inputs before side effects", async () => {
  const sessionDir = makeWorkspace("handler-validation");
  let sendCommandCalled = false;
  const bridge = {
    getStatus: () => createStubBridge().getStatus(),
    async sendCommand() {
      sendCommandCalled = true;
      throw new Error("sendCommand should not run for rejected inputs");
    },
  };

  const cobrowserTools = createForkCobrowserTools(sessionDir);
  const browserExtensionTools = createForkBrowserExtensionTools(sessionDir, bridge);
  const allTools = [...cobrowserTools, ...browserExtensionTools];
  const getHandler = (name) => allTools.find((tool) => tool.name === name)?.handler;

  const navigateResult = await getHandler("cobrowser_browserext_control_tab")({
    action: "navigate",
    url: "javascript:alert(1)",
  });
  assert.match(navigateResult, /URL scheme not permitted/);
  assert.equal(sendCommandCalled, false, "malicious navigate input must be rejected before bridge calls");

  const attachResult = await getHandler("cobrowser_attach_tab")({
    cdp_endpoint: "http://169.254.169.254",
  });
  assert.match(attachResult, /CDP endpoint must use a loopback host/);

  const invalidPortResult = await getHandler("cobrowser_attach_tab")({
    debug_port: "banana",
  });
  assert.match(invalidPortResult, /debug_port must be an integer between 1 and 65535/);

  const reservedPortResult = await getHandler("cobrowser_attach_tab")({
    debug_port: 44777,
  });
  assert.match(reservedPortResult, /reserved for the co-browser bridge/);

  const outsidePath = resolve(sessionDir, "..", "outside-capture.png");
  const captureResult = await getHandler("cobrowser_capture_screenshot")({
    name: "portal-login",
    step: "capture",
    state_summary: "Login screen is visible",
    screenshot_path: outsidePath,
  });
  assert.match(captureResult, /screenshot_path must stay inside data\/sessions\//);
  assert.equal(existsSync(outsidePath), false, "path rejection must happen before any screenshot write");

  const checkpointResult = await getHandler("cobrowser_checkpoint")({
    name: "portal-login",
    step: "checkpoint",
    state_summary: "Login screen is visible",
    observed_url: "javascript:alert(1)",
  });
  assert.match(checkpointResult, /observed_url rejected/);

  const clearResult = await getHandler("cobrowser_clear_session")({
    name: "../../../etc",
  });
  assert.match(clearResult, /Session name rejected/);
});

test("browser-extension attach handler escapes end markers in extracted content", async () => {
  const sessionDir = makeWorkspace("handler-wrap");
  const bridge = {
    getStatus: () => createStubBridge().getStatus(),
    async sendCommand(commandType) {
      assert.equal(commandType, "inspect-tab");
      return {
        clientInstanceId: "client-1",
        tab: {
          windowId: 1,
          tabId: 2,
          title: "Injected Page",
          url: "https://example.com/",
        },
        bodyText: `prefix ${UNTRUSTED_END} middle ${UNTRUSTED_END} suffix`,
        selectorText: `selector ${UNTRUSTED_END}`,
        selectedText: null,
        selectorFound: true,
        expectedTextPresent: true,
        screenshotDataUrl: null,
      };
    },
  };

  const attachHandler = createForkBrowserExtensionTools(sessionDir, bridge)
    .find((tool) => tool.name === "cobrowser_browserext_attach_tab")
    .handler;

  const message = await attachHandler({
    name: "marker-test",
    selector: "#content",
    expected_text: "prefix",
    capture_screenshot: false,
  });
  assert.match(message, /browser-extension inspection completed/);

  const session = JSON.parse(readFileSync(join(sessionDir, "marker-test.json"), "utf-8"));
  assert.equal(session.bodyText.split(UNTRUSTED_END).length - 1, 1, "wrapped body text must retain only the outer end marker");
  assert.equal(session.selectorText.split(UNTRUSTED_END).length - 1, 1, "wrapped selector text must retain only the outer end marker");
  assert.match(session.bodyText, /\[·END UNTRUSTED WEB CONTENT\]/);
  assert.match(session.selectorText, /\[·END UNTRUSTED WEB CONTENT\]/);
});

test("fork preserves the upstream 12-tool surface and key hardening hooks", () => {
  const sessionDir = makeWorkspace("surface");
  const bridge = createStubBridge();

  const forkTools = [
    ...createForkCobrowserTools(sessionDir),
    ...createForkBrowserExtensionTools(sessionDir, bridge),
  ];
  assert.equal(forkTools.length, 12);
  assert.deepEqual(normalizeSurface(forkTools), expectedToolSurface);

  const extensionEntry = readFileSync(resolve(extensionRoot, "extension.mjs"), "utf-8");
  const cobrowserTools = readFileSync(resolve(extensionRoot, "tools", "cobrowser-tools.mjs"), "utf-8");
  const bridgeSource = readFileSync(resolve(extensionRoot, "tools", "browser-extension-bridge.mjs"), "utf-8");
  const backgroundSource = readFileSync(resolve(extensionRoot, "browser-extension", "background.js"), "utf-8");
  const securityUtilsSource = readFileSync(resolve(extensionRoot, "tools", "security-utils.mjs"), "utf-8");

  assert.equal(extensionEntry.includes("approveAll"), false);
  assert.equal(cobrowserTools.includes("shell: true"), false);
  assert.equal(cobrowserTools.includes("tmpdir("), false);
  assert.ok(cobrowserTools.includes("previewText(summary.bodyText)"));
  assert.ok(cobrowserTools.includes("previewText(summary.extractedText)"));
  assert.ok(cobrowserTools.includes("validateDebugPort"));
  assert.ok(bridgeSource.includes("X-Bridge-Token"));
  assert.ok(bridgeSource.includes("destroyOversizedRequest"));
  assert.equal(bridgeSource.includes("Unknown route:"), false);
  assert.equal(bridgeSource.includes("setHeader(\"Access-Control-Allow-Origin\""), false);
  assert.equal(securityUtilsSource.includes("\\u200B"), false);
  assert.ok(backgroundSource.includes('world: "ISOLATED"'));
  assert.ok(backgroundSource.includes("response.status === 401"));
});
