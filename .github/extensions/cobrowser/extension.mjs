import { mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession } from "@github/copilot-sdk/extension";

import { createCobrowserTools } from "./tools/cobrowser-tools.mjs";
import { createBrowserExtensionBridge } from "./tools/browser-extension-bridge.mjs";
import { createBrowserExtensionTools } from "./tools/browser-extension-tools.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extDir = resolve(__dirname);
const sessionDir = join(extDir, "data", "sessions");
const browserExtensionDir = join(extDir, "browser-extension");

mkdirSync(sessionDir, { recursive: true });
mkdirSync(browserExtensionDir, { recursive: true });

const rawBrowserExtensionBridge = createBrowserExtensionBridge({
  port: 44777,
  extensionDir: browserExtensionDir,
});

await rawBrowserExtensionBridge.ensureStarted();

const browserExtensionBridge = {
  getStatus() {
    const instances = rawBrowserExtensionBridge.listInstances();
    return {
      started: true,
      httpUrl: rawBrowserExtensionBridge.bridgeEndpoint(),
      websocketUrl: null,
      browserExtensionDir,
      startupError: null,
      connectedClients: instances,
    };
  },
  async sendCommand(command, args = {}, options = {}) {
    return await rawBrowserExtensionBridge.runCommand(command, args, options);
  },
  async stop() {
    await rawBrowserExtensionBridge.close();
  },
};

await joinSession({
  // Verified against @github/copilot-sdk 1.0.52-1: joinSession() defaults to
  // defaultJoinSessionPermissionHandler, which delegates permission prompting to the CLI.
  hooks: {
    onSessionStart: async () => {
      const status = browserExtensionBridge.getStatus();
      console.error(`cobrowser: extension loaded | browser-extension bridge ${status.httpUrl}`);
    },
  },
  tools: [
    ...createCobrowserTools(sessionDir),
    ...createBrowserExtensionTools(sessionDir, browserExtensionBridge),
  ],
});
