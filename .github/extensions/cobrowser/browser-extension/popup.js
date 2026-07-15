function getElementByIdOrThrow(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element with id '${id}' not found.`);
  }
  return element;
}

const connection = getElementByIdOrThrow("connection");
const bridgeEndpoint = getElementByIdOrThrow("bridgeEndpoint");
const activeTab = getElementByIdOrThrow("activeTab");
const instanceId = getElementByIdOrThrow("instanceId");
const saveButton = getElementByIdOrThrow("saveButton");
const refreshButton = getElementByIdOrThrow("refreshButton");

function validatePopupEndpoint(raw) {
  const parsed = new URL(String(raw || "").trim());
  if (parsed.protocol !== "http:") {
    throw new Error("Protocol must be http:");
  }
  if (parsed.hostname !== "127.0.0.1") {
    throw new Error("Hostname must be 127.0.0.1");
  }
  if (parsed.port !== "44777") {
    throw new Error("Port must be 44777");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("No credentials, query, or fragment are allowed");
  }
  if (parsed.pathname && parsed.pathname !== "/") {
    throw new Error("Endpoint path must be root only");
  }
  return "http://127.0.0.1:44777";
}

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: "getStatus" });
  connection.textContent = status.connected ? "Connected" : `Disconnected${status.lastError ? `: ${status.lastError}` : ""}`;
  connection.className = status.connected ? "value status-ok" : "value status-off";
  bridgeEndpoint.value = status.bridgeEndpoint || "http://127.0.0.1:44777";
  activeTab.textContent = status.activeTab ? `${status.activeTab.title || "(no title)"} | ${status.activeTab.url || "(no URL)"}` : "None";
  instanceId.textContent = status.instanceId || "Unknown";
}

saveButton.addEventListener("click", async () => {
  try {
    const normalizedEndpoint = validatePopupEndpoint(bridgeEndpoint.value.trim());
    const response = await chrome.runtime.sendMessage({ type: "setBridgeEndpoint", bridgeEndpoint: normalizedEndpoint });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to update bridge endpoint.");
    }
    await refresh();
  } catch (error) {
    connection.textContent = `Invalid endpoint: ${String(error?.message || error)}`;
    connection.className = "value status-off";
  }
});

refreshButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "reconnectBridge" });
  await refresh();
});

refresh();
