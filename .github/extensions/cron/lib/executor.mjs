// Command executor — spawn a command with timeout, combined output, process tree kill.

import { spawn } from "node:child_process";
import { basename } from "node:path";

const COMMAND_ALLOWLIST = new Set([
  "node", "python", "python3", "gh", "az",
  "powershell", "pwsh", "git", "npm", "npx", "dotnet",
]);

/** Redact likely secrets from command output before persistence. */
function redactSecrets(text) {
  if (!text) return text;
  return text
    .replace(/(password|secret|token|apikey|api_key|access_key|client_secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]{20,}/g, "Bearer [REDACTED]")
    .replace(/DefaultEndpointsProtocol=[^;\s]+(;[^;\s]+)*/g, "[REDACTED_CONNECTION_STRING]")
    .replace(/-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]");
}

/**
 * Execute a command payload.
 * @param {object} payload - { command, arguments, workingDirectory, timeoutSeconds }
 * @returns {Promise<{ success: boolean, output: string, durationMs: number, error?: string }>}
 */
export function executeCommand(payload) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const timeoutMs = (payload.timeoutSeconds || 300) * 1000;
    const MAX_OUTPUT = 1024 * 1024; // 1MB cap

    // Command allowlist check
    const cmd = basename(payload.command).replace(/\.exe$/i, "");
    if (!COMMAND_ALLOWLIST.has(cmd.toLowerCase())) {
      resolve({
        success: false,
        output: "",
        durationMs: Date.now() - startTime,
        error: `Command not in allowlist: '${payload.command}'. Allowed: ${[...COMMAND_ALLOWLIST].join(", ")}`,
      });
      return;
    }

    // Parse arguments into array — no shell interpretation
    const args = payload.arguments
      ? (payload.arguments.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(a => a.replace(/^["']|["']$/g, ""))
      : [];
    const options = {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      cwd: payload.workingDirectory || undefined,
    };

    let child;
    try {
      child = spawn(payload.command, args, options);
    } catch (err) {
      resolve({
        success: false,
        output: "",
        durationMs: Date.now() - startTime,
        error: `Failed to spawn: ${err.message}`,
      });
      return;
    }

    let output = "";
    let outputSize = 0;
    let killed = false;

    const appendOutput = (chunk) => {
      if (outputSize >= MAX_OUTPUT) return;
      const text = chunk.toString();
      output += text.slice(0, MAX_OUTPUT - outputSize);
      outputSize += text.length;
    };
    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);

    const timer = setTimeout(() => {
      killed = true;
      killProcessTree(child.pid);
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output,
        durationMs: Date.now() - startTime,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (killed) {
        resolve({
          success: false,
          output: redactSecrets(output),
          durationMs,
          error: `Timed out after ${payload.timeoutSeconds}s`,
        });
      } else {
        resolve({
          success: code === 0,
          output: redactSecrets(output),
          durationMs,
          error: code !== 0 ? `Exit code ${code}` : undefined,
        });
      }
    });
  });
}

/**
 * Kill a process tree.
 * On Windows: taskkill /T /F /PID
 * On Unix: kill the process group
 */
function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/T", "/F", "/PID", String(pid)], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      // Kill the process group
      try { process.kill(-pid, "SIGKILL"); } catch { /* ignore */ }
      try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
    }
  } catch {
    // Best effort
  }
}
