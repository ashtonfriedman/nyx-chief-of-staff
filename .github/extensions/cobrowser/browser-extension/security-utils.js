export const DEFAULT_BRIDGE_ENDPOINT = "http://127.0.0.1:44777";
export const BACKOFF_DELAYS = [100, 200, 400, 800, 1600];
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

function sanitizeUrlForLog(value) {
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

export function logExtensionSecurityEvent(eventType, source, detail = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    eventType,
    source,
    detail,
  };
  console.error(`cobrowser-security ${JSON.stringify(payload)}`);
}

export function validateNavigationUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return { ok: false, reason: "URL is required." };
  }
  if (raw.startsWith("-")) {
    return { ok: false, reason: "URL must not start with '-'." };
  }

  try {
    const parsed = new URL(raw);
    if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
      return { ok: false, reason: `URL scheme not permitted: ${parsed.protocol}` };
    }
    return { ok: true, normalizedUrl: parsed.toString() };
  } catch {
    return { ok: false, reason: "URL must be an absolute http(s) URL." };
  }
}

export function validateBridgeEndpoint(value, { source = "bridgeEndpoint", eventType = "endpointRejected", logger = logExtensionSecurityEvent } = {}) {
  const raw = String(value || "").trim();
  let reason = null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:") {
      reason = "Protocol must be http:.";
    } else if (parsed.hostname !== "127.0.0.1") {
      reason = "Hostname must be 127.0.0.1.";
    } else if (parsed.port !== "44777") {
      reason = "Port must be 44777.";
    } else if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      reason = "Endpoint must not include credentials, query parameters, or fragments.";
    } else if (parsed.pathname && parsed.pathname !== "/") {
      reason = "Endpoint path must be root only.";
    } else {
      return { ok: true, normalizedEndpoint: DEFAULT_BRIDGE_ENDPOINT };
    }
  } catch {
    reason = "Endpoint must be a valid absolute URL.";
  }

  logger(eventType, source, { endpoint: sanitizeUrlForLog(raw), reason });
  return { ok: false, reason };
}

export async function readBridgeToken({ fetchImpl, getRuntimeUrl, cacheBust } = {}) {
  const runtimePath = getRuntimeUrl("bridge-token.json");
  const response = await fetchImpl(`${runtimePath}?t=${cacheBust ?? Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("bridge-token.json not found or unreadable");
  }

  const payload = await response.json();
  if (!payload?.token || typeof payload.token !== "string") {
    throw new Error("bridge-token.json did not contain a token");
  }

  return payload;
}

export async function bootstrapBridgeAuth({
  readBridgeTokenImpl,
  validateBridgeEndpointImpl = validateBridgeEndpoint,
  delayImpl,
  backoffDelays = BACKOFF_DELAYS,
} = {}) {
  let lastError = new Error("Bootstrap failed: bridge-token.json not found or invalid after ~3s");

  for (let attempt = 0; attempt < backoffDelays.length; attempt += 1) {
    try {
      const payload = await readBridgeTokenImpl();
      const endpoint = validateBridgeEndpointImpl(payload.bridgeEndpoint, { source: "bridge-token.json" });
      if (!endpoint.ok) {
        throw new Error(endpoint.reason);
      }
      return {
        token: payload.token,
        bridgeEndpoint: endpoint.normalizedEndpoint,
        generatedAt: payload.generatedAt || null,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < backoffDelays.length - 1) {
        await delayImpl(backoffDelays[attempt]);
      }
    }
  }

  throw new Error(`Bootstrap failed: ${lastError.message}`);
}
