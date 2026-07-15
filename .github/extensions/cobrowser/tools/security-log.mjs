import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_SECURITY_LOG_PATH = fileURLToPath(new URL("../data/cobrowser-security.log", import.meta.url));
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const SENSITIVE_KEYS = new Set([
  "token",
  "bridgeToken",
  "xBridgeToken",
  "authorization",
  "headers",
  "requestHeaders",
  "body",
  "requestBody",
  "rawBody",
]);

export function sanitizeUrlForLog(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  }
}

function normalizeDetail(value, key = "") {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return key.toLowerCase().includes("url") || key.toLowerCase().includes("endpoint")
      ? sanitizeUrlForLog(value)
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDetail(entry, key)).filter((entry) => entry !== undefined);
  }

  if (typeof value === "object") {
    const normalized = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(entryKey)) {
        continue;
      }
      const normalizedValue = normalizeDetail(entryValue, entryKey);
      if (normalizedValue !== undefined) {
        normalized[entryKey] = normalizedValue;
      }
    }
    return normalized;
  }

  return String(value);
}

function rotateLogFiles(logFilePath) {
  try {
    if (!existsSync(logFilePath)) {
      return;
    }

    const size = statSync(logFilePath).size;
    if (size <= MAX_LOG_BYTES) {
      return;
    }

    const rotatedOne = `${logFilePath}.1`;
    const rotatedTwo = `${logFilePath}.2`;

    if (existsSync(rotatedTwo)) {
      unlinkSync(rotatedTwo);
    }
    if (existsSync(rotatedOne)) {
      renameSync(rotatedOne, rotatedTwo);
    }
    renameSync(logFilePath, rotatedOne);
  } catch {
    // Best effort only; logging should not throw because rotation failed.
  }
}

export function logSecurityEvent(eventType, source, detail = {}, logFilePath = DEFAULT_SECURITY_LOG_PATH) {
  const targetPath = logFilePath || DEFAULT_SECURITY_LOG_PATH;
  mkdirSync(dirname(targetPath), { recursive: true });
  rotateLogFiles(targetPath);

  const entry = {
    timestamp: new Date().toISOString(),
    eventType,
    source,
    detail: normalizeDetail(detail),
  };

  appendFileSync(targetPath, `${JSON.stringify(entry)}\n`, "utf-8");
}
