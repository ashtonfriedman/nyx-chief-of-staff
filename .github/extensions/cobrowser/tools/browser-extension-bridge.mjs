import { execFile } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:http";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_SECURITY_LOG_PATH, logSecurityEvent } from "./security-log.mjs";

export const DEFAULT_BROWSER_EXTENSION_BRIDGE_HOST = "127.0.0.1";
export const DEFAULT_BROWSER_EXTENSION_BRIDGE_PORT = 44777;
const DEFAULT_BROWSER_EXTENSION_DIR = fileURLToPath(new URL("../browser-extension/", import.meta.url));
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large.");
    this.name = "BodyTooLargeError";
  }
}

function withNoAcao(res) {
  // Intentionally omit Access-Control-Allow-Origin for every origin.
  // The extension service worker relies on manifest host_permissions instead.
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Token");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, statusCode, payload) {
  withNoAcao(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function destroyOversizedRequest(req, res) {
  if (req.destroyed) {
    return;
  }

  req.on("error", () => {});
  const destroy = () => {
    if (!req.destroyed) {
      req.destroy();
    }
  };
  res.once("finish", destroy);
  res.once("close", destroy);
}

function sendRequestError(req, res, error) {
  if (error instanceof BodyTooLargeError) {
    destroyOversizedRequest(req, res);
    res.setHeader("Connection", "close");
    sendJson(res, 413, {
      ok: false,
      error: "Request body too large.",
    });
    return;
  }

  const invalidJson = error instanceof SyntaxError;
  sendJson(res, invalidJson ? 400 : 500, {
    ok: false,
    error: invalidJson ? "Invalid JSON request body." : "Internal server error.",
  });
}

async function readJsonBody(req) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new BodyTooLargeError();
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const bufferChunk = Buffer.from(chunk);
    totalBytes += bufferChunk.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function sortInstancesByActivity(instances) {
  return [...instances].sort((left, right) => String(right.lastSeen || "").localeCompare(String(left.lastSeen || "")));
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      file,
      args,
      {
        shell: false,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectPromise(new Error((stderr || stdout || error.message || "Command failed.").trim()));
          return;
        }

        resolvePromise((stdout || "").trim());
      },
    );
  });
}

export function createBrowserExtensionBridge(options = {}) {
  const host = options.host || DEFAULT_BROWSER_EXTENSION_BRIDGE_HOST;
  const port = Number(options.port || DEFAULT_BROWSER_EXTENSION_BRIDGE_PORT);
  const pollHoldMs = Number(options.pollHoldMs || 20000);
  const commandTimeoutMs = Number(options.commandTimeoutMs || 20000);
  const extensionDir = resolve(options.extensionDir || DEFAULT_BROWSER_EXTENSION_DIR);
  const logFilePath = options.logFilePath || DEFAULT_SECURITY_LOG_PATH;

  const instances = new Map();
  const commandQueues = new Map();
  const pollWaiters = new Map();
  const pendingCommands = new Map();
  const sockets = new Set();

  const bridgeToken = randomBytes(32).toString("hex");
  const bridgeTokenBuf = Buffer.from(bridgeToken, "utf8");
  const tokenFilePath = join(extensionDir, "bridge-token.json");
  const tempTokenFilePath = `${tokenFilePath}.tmp`;

  let server;
  let startPromise;
  let tokenGeneratedAt = null;

  function bridgeEndpoint() {
    return `http://${host}:${port}`;
  }

  function snapshotInstance(instance) {
    return {
      instanceId: instance.instanceId,
      browserName: instance.browserName || null,
      extensionVersion: instance.extensionVersion || null,
      lastSeen: instance.lastSeen || null,
      activeTab: instance.activeTab || null,
      capabilities: instance.capabilities || [],
    };
  }

  function getQueue(instanceId) {
    const existing = commandQueues.get(instanceId);
    if (existing) {
      return existing;
    }

    const queue = [];
    commandQueues.set(instanceId, queue);
    return queue;
  }

  function upsertInstance(payload = {}) {
    const instanceId = String(payload.instanceId || "").trim();
    if (!instanceId) {
      return null;
    }

    const current = instances.get(instanceId) || {
      instanceId,
      createdAt: new Date().toISOString(),
      browserName: null,
      extensionVersion: null,
      lastSeen: null,
      activeTab: null,
      capabilities: [],
    };

    current.browserName = payload.browserName || current.browserName || "chromium-browser-extension";
    current.extensionVersion = payload.extensionVersion || current.extensionVersion || null;
    current.capabilities = Array.isArray(payload.capabilities) ? payload.capabilities : current.capabilities || [];
    current.activeTab = payload.activeTab || current.activeTab || null;
    current.lastSeen = new Date().toISOString();

    instances.set(instanceId, current);
    return current;
  }

  function listInstances() {
    return sortInstancesByActivity(instances.values()).map(snapshotInstance);
  }

  function selectInstance(instanceId, commandType = null) {
    if (instanceId) {
      return instances.get(instanceId) || null;
    }

    const sorted = sortInstancesByActivity(instances.values());
    if (!commandType) {
      return sorted[0] || null;
    }

    return sorted.find((instance) => Array.isArray(instance.capabilities) && instance.capabilities.includes(commandType)) || sorted[0] || null;
  }

  function takeQueuedCommand(instanceId) {
    const queue = getQueue(instanceId);
    return queue.length > 0 ? queue.shift() : null;
  }

  function deliverCommand(instanceId, command) {
    const waiter = pollWaiters.get(instanceId);
    if (waiter) {
      pollWaiters.delete(instanceId);
      clearTimeout(waiter.timer);
      waiter.resolve(command);
      return;
    }

    getQueue(instanceId).push(command);
  }

  async function waitForCommand(instanceId) {
    const immediate = takeQueuedCommand(instanceId);
    if (immediate) {
      return immediate;
    }

    return await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        const current = pollWaiters.get(instanceId);
        if (current && current.resolve === resolvePromise) {
          pollWaiters.delete(instanceId);
        }
        resolvePromise(null);
      }, pollHoldMs);

      pollWaiters.set(instanceId, {
        resolve: resolvePromise,
        timer,
      });
    });
  }

  function resolvePendingCommand(commandId, payload, isError) {
    const pending = pendingCommands.get(commandId);
    if (!pending) {
      return false;
    }

    pendingCommands.delete(commandId);
    clearTimeout(pending.timer);

    if (isError) {
      pending.reject(new Error(String(payload || "Browser extension command failed.")));
      return true;
    }

    pending.resolve(payload);
    return true;
  }

  async function applyWindowsAcl(filePath) {
    const username = userInfo().username;
    await execFileAsync("icacls.exe", [
      filePath,
      "/inheritance:r",
      "/grant:r",
      `${username}:(R,W)`,
    ]);
  }

  async function writeBridgeTokenFile() {
    mkdirSync(extensionDir, { recursive: true });
    tokenGeneratedAt = new Date().toISOString();
    const payload = JSON.stringify({
      token: bridgeToken,
      generatedAt: tokenGeneratedAt,
      bridgeEndpoint: bridgeEndpoint(),
    }, null, 2);

    try {
      unlinkSync(tempTokenFilePath);
    } catch {
      // Best-effort cleanup only.
    }

    if (process.platform === "win32") {
      writeFileSync(tempTokenFilePath, "", { flag: "w" });
      await applyWindowsAcl(tempTokenFilePath);
      writeFileSync(tempTokenFilePath, payload, "utf-8");
      renameSync(tempTokenFilePath, tokenFilePath);
      await applyWindowsAcl(tokenFilePath);
    } else {
      const fd = openSync(tempTokenFilePath, "wx", 0o600);
      try {
        writeSync(fd, payload);
      } finally {
        closeSync(fd);
      }
      renameSync(tempTokenFilePath, tokenFilePath);
      chmodSync(tokenFilePath, 0o600);
    }

    console.error(`cobrowser: bridge token generated at ${tokenGeneratedAt}`);
  }

  function validateToken(req) {
    const header = req.headers["x-bridge-token"];
    if (!header || Array.isArray(header)) {
      return false;
    }

    const headerBuf = Buffer.from(String(header), "utf8");
    if (headerBuf.length !== bridgeTokenBuf.length) {
      return false;
    }

    return timingSafeEqual(headerBuf, bridgeTokenBuf);
  }

  function requireAuth(req, res, path) {
    if (validateToken(req)) {
      return true;
    }

    logSecurityEvent("authFailure", path, {
      method: req.method || "GET",
      remoteAddress: req.socket?.remoteAddress || null,
    }, logFilePath);
    sendJson(res, 401, {
      ok: false,
      error: "Unauthorized",
    });
    return false;
  }

  async function handlePoll(req, res) {
    try {
      const body = await readJsonBody(req);
      const instance = upsertInstance(body);
      if (!instance) {
        sendJson(res, 400, {
          ok: false,
          error: "instanceId is required.",
        });
        return;
      }

      const command = await waitForCommand(instance.instanceId);
      sendJson(res, 200, {
        ok: true,
        bridge: {
          endpoint: bridgeEndpoint(),
          host,
          port,
        },
        command,
      });
    } catch (error) {
      sendRequestError(req, res, error);
    }
  }

  async function handleResult(req, res) {
    try {
      const body = await readJsonBody(req);
      upsertInstance(body);
      const commandId = String(body.commandId || "").trim();
      if (!commandId) {
        sendJson(res, 400, {
          ok: false,
          error: "commandId is required.",
        });
        return;
      }

      const handled = resolvePendingCommand(commandId, body.ok === false ? body.error : body.result, body.ok === false);
      sendJson(res, handled ? 200 : 404, {
        ok: handled,
        error: handled ? null : "Unknown commandId.",
      });
    } catch (error) {
      sendRequestError(req, res, error);
    }
  }

  async function ensureStarted() {
    if (startPromise) {
      return startPromise;
    }

    startPromise = (async () => {
      await writeBridgeTokenFile();

      await new Promise((resolvePromise, rejectPromise) => {
        server = createServer(async (req, res) => {
          const path = String(req.url || "").split("?")[0];

          if (req.method === "OPTIONS") {
            withNoAcao(res);
            res.statusCode = 204;
            res.end();
            return;
          }

          const requiresAuth = (req.method === "POST" && (path === "/api/poll" || path === "/api/result"))
            || (req.method === "GET" && path === "/api/health");
          if (requiresAuth && !requireAuth(req, res, path)) {
            return;
          }

          if (req.method === "GET" && path === "/api/health") {
            sendJson(res, 200, {
              ok: true,
              bridge: {
                endpoint: bridgeEndpoint(),
                host,
                port,
              },
              instanceCount: instances.size,
            });
            return;
          }

          if (req.method === "POST" && path === "/api/poll") {
            await handlePoll(req, res);
            return;
          }

          if (req.method === "POST" && path === "/api/result") {
            await handleResult(req, res);
            return;
          }

          sendJson(res, 404, {
            ok: false,
            error: "Not found.",
          });
        });

        server.on("connection", (socket) => {
          sockets.add(socket);
          socket.on("close", () => sockets.delete(socket));
        });

        server.on("error", (error) => {
          rejectPromise(error);
        });

        server.listen(port, host, () => {
          resolvePromise({ endpoint: bridgeEndpoint(), host, port, extensionDir });
        });
      });

      return { endpoint: bridgeEndpoint(), host, port, extensionDir };
    })();

    return await startPromise;
  }

  async function runCommand(commandType, payload = {}, options = {}) {
    await ensureStarted();

    const target = selectInstance(options.instanceId || null, commandType);
    if (!target) {
      throw new Error(
        `No browser extension instance is connected. Load the unpacked extension from ${extensionDir || "the browser-extension folder"} and browse the target tab.`,
      );
    }

    const commandId = randomUUID();
    const timeoutMs = Number(options.timeoutMs || commandTimeoutMs);

    const resultPromise = new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(commandId);
        rejectPromise(new Error(`Browser extension command timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      pendingCommands.set(commandId, {
        resolve: resolvePromise,
        reject: rejectPromise,
        timer,
      });
    });

    deliverCommand(target.instanceId, {
      id: commandId,
      type: commandType,
      payload,
    });

    return await resultPromise;
  }

  async function close() {
    for (const waiter of pollWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    pollWaiters.clear();

    for (const pending of pendingCommands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Browser extension bridge closed."));
    }
    pendingCommands.clear();

    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();

    try {
      unlinkSync(tokenFilePath);
    } catch {
      // Best-effort cleanup only.
    }
    try {
      unlinkSync(tempTokenFilePath);
    } catch {
      // Best-effort cleanup only.
    }

    if (!server) {
      startPromise = null;
      return;
    }

    await new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(resolvePromise, 1000);
      server.close((error) => {
        clearTimeout(timer);
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });

    server = null;
    startPromise = null;
  }

  return {
    host,
    port,
    extensionDir,
    bridgeEndpoint,
    ensureStarted,
    listInstances,
    runCommand,
    close,
  };
}
