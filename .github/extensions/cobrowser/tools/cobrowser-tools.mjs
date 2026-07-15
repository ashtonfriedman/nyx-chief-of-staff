import { chromium } from "playwright-core";
import { execFile, spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import {
  ensureDir,
  nowStamp,
  previewText,
  resolveManagedPath,
  resolvePathWithinRoot,
  sessionFile,
  slugify,
  validateCaptureMode,
  validateCdpEndpoint,
  validateSessionNameComponent,
  validateUrl,
  wrapUntrusted,
  writeJsonFile,
} from "./security-utils.mjs";

const isWindows = process.platform === "win32";
const STORED_PROBE_TEXT_CHARS = 12000;
const DEFAULT_DEBUG_PORT = 9222;
const RESERVED_BRIDGE_PORT = 44777;

const EDGE_PATHS = isWindows
  ? [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    ]
  : process.platform === "darwin"
    ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"];

const CHROME_PATHS = isWindows
  ? [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    ]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser"];

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

function detectBrowser(browserPreference = "auto") {
  const groups = {
    msedge: EDGE_PATHS,
    chrome: CHROME_PATHS,
    auto: [...EDGE_PATHS, ...CHROME_PATHS],
  };

  const candidates = groups[browserPreference] || groups.auto;
  for (const candidate of candidates) {
    const normalized = resolve(candidate);
    if (existsSync(normalized)) {
      const browserName = basename(normalized).toLowerCase().includes("edge") ? "msedge" : "chrome";
      return { browserName, executablePath: normalized };
    }
  }

  return null;
}

function openBrowser(url) {
  const detection = detectBrowser();
  if (!detection) {
    return {
      ok: false,
      reason: "No supported local Edge or Chrome installation was found.",
    };
  }

  if (isWindows) {
    execFile(detection.executablePath, [url], {
      shell: false,
      windowsHide: false,
    }, () => {});
  } else {
    const child = spawn(detection.executablePath, [url], {
      shell: false,
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  }

  return {
    ok: true,
    browserName: detection.browserName,
    executablePath: detection.executablePath,
  };
}

async function captureWindowsScreenshot(path, captureMode) {
  const escapedPath = String(path).replace(/'/g, "''");
  const escapedMode = String(captureMode || "active-window").replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class CobrowserWin32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
}
"@

$path = '${escapedPath}'
$captureMode = '${escapedMode}'

if ($captureMode -eq 'screen') {
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
}
else {
  $handle = [CobrowserWin32]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) {
    throw 'No foreground window is available to capture.'
  }

  $rect = New-Object CobrowserWin32+RECT
  [void][CobrowserWin32]::GetWindowRect($handle, [ref]$rect)
  $width = [Math]::Max(1, $rect.Right - $rect.Left)
  $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CopyFromScreen((New-Object System.Drawing.Point($rect.Left, $rect.Top)), [System.Drawing.Point]::Empty, (New-Object System.Drawing.Size($width, $height)))
}

try {
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  if ($graphics) { $graphics.Dispose() }
  if ($bitmap) { $bitmap.Dispose() }
}

Write-Output $path
`;

  await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]);
}

function readSession(path) {
  if (!existsSync(path)) {
    return null;
  }

  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeSession(path, payload) {
  writeJsonFile(path, payload);
}

function defaultCdpEndpoint(debugPort) {
  return `http://127.0.0.1:${debugPort}`;
}

function validateDebugPort(value, { reservedAllowed = false } = {}) {
  const rawValue = value ?? DEFAULT_DEBUG_PORT;
  const debugPort = Number(rawValue);
  if (!Number.isInteger(debugPort) || debugPort < 1 || debugPort > 65535) {
    return {
      ok: false,
      reason: `debug_port must be an integer between 1 and 65535 (got: ${value ?? DEFAULT_DEBUG_PORT})`,
    };
  }

  if (!reservedAllowed && debugPort === RESERVED_BRIDGE_PORT) {
    return {
      ok: false,
      reason: `debug_port ${RESERVED_BRIDGE_PORT} is reserved for the co-browser bridge.`,
    };
  }

  return {
    ok: true,
    debugPort,
  };
}

function normalizeCdpEndpoint(args = {}) {
  if (args.cdp_endpoint) {
    const validation = validateCdpEndpoint(args.cdp_endpoint, {
      source: args.source || "cobrowser_attach_tab",
    });
    return validation.ok ? validation : validation;
  }

  const debugPortValidation = validateDebugPort(args.debug_port);
  if (!debugPortValidation.ok) {
    return debugPortValidation;
  }

  return {
    ok: true,
    normalizedEndpoint: defaultCdpEndpoint(debugPortValidation.debugPort),
  };
}

function appendCheckpoint(sessionDir, args) {
  let observedUrl = null;
  if (args.observed_url) {
    const urlValidation = validateUrl(args.observed_url, { source: "cobrowser_checkpoint" });
    if (!urlValidation.ok) {
      throw new Error(`observed_url rejected: ${urlValidation.reason}`);
    }
    observedUrl = urlValidation.normalizedUrl;
  }

  const filePath = sessionFile(sessionDir, args.name);
  const session = readSession(filePath) || {
    name: args.name,
    createdAt: new Date().toISOString(),
    mode: "guided-browser",
    targetUrl: observedUrl,
    checkpoints: [],
  };

  session.updatedAt = new Date().toISOString();
  session.checkpoints = session.checkpoints || [];
  session.checkpoints.push({
    recordedAt: new Date().toISOString(),
    step: args.step,
    status: args.status || "recorded",
    observedUrl,
    stateSummary: args.state_summary,
    expectedOutcome: args.expected_outcome || null,
    actualOutcome: args.actual_outcome || null,
    errorText: args.error_text || null,
    screenshotPath: args.screenshot_path || null,
    nextStep: args.next_step || null,
  });

  writeSession(filePath, session);
  return filePath;
}

async function runPlaywrightProbe(sessionDir, args) {
  const urlValidation = validateUrl(args.url, { source: "cobrowser_probe" });
  if (!urlValidation.ok) {
    return {
      ok: false,
      message: `URL rejected: ${urlValidation.reason}`,
    };
  }

  const detection = detectBrowser(args.browser || "auto");
  if (!detection) {
    return {
      ok: false,
      message: "No supported local Edge or Chrome installation was found for Playwright to launch.",
    };
  }

  const normalizedUrl = urlValidation.normalizedUrl;
  const name = args.name || `probe-${slugify(normalizedUrl)}`;
  const filePath = sessionFile(sessionDir, name);
  const evidenceDir = join(sessionDir, slugify(name));
  ensureDir(evidenceDir);

  const screenshotResult = resolveManagedPath(
    sessionDir,
    args.screenshot_path,
    join(evidenceDir, `${slugify(name)}-${nowStamp()}.png`),
    {
      source: "cobrowser_probe",
      detailKey: "screenshotPath",
      message: "screenshot_path must stay inside data/sessions/",
    },
  );
  if (!screenshotResult.ok) {
    return {
      ok: false,
      message: screenshotResult.reason,
    };
  }

  const browser = await chromium.launch({
    executablePath: detection.executablePath,
    headless: args.show_browser === true ? false : true,
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: args.ignore_https_errors === true,
  });
  const page = await context.newPage();
  const timeout = Number(args.timeout_ms || 15000);
  const summary = {
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: "playwright-probe",
    browser: detection.browserName,
    executablePath: detection.executablePath,
    startUrl: normalizedUrl,
    finalUrl: null,
    title: null,
    waitForSelector: args.wait_for_selector || null,
    waitForSelectorFound: null,
    expectedText: args.expected_text || null,
    expectedTextPresent: null,
    bodyText: null,
    screenshotPath: null,
    checkpoints: [],
  };

  try {
    await page.goto(normalizedUrl, { waitUntil: "domcontentloaded", timeout });
    try {
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 5000) });
    } catch {
      // Network idle is useful but not mandatory.
    }

    if (args.wait_for_selector) {
      try {
        await page.waitForSelector(args.wait_for_selector, { timeout });
        summary.waitForSelectorFound = true;
      } catch {
        summary.waitForSelectorFound = false;
      }
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (args.expected_text) {
      summary.expectedTextPresent = bodyText.includes(args.expected_text);
    }
    summary.bodyText = wrapUntrusted(bodyText.slice(0, STORED_PROBE_TEXT_CHARS));

    summary.finalUrl = page.url();
    summary.title = await page.title();

    if (args.capture_screenshot !== false) {
      ensureDir(dirname(screenshotResult.resolvedPath));
      await page.screenshot({ path: screenshotResult.resolvedPath, fullPage: true });
      summary.screenshotPath = screenshotResult.resolvedPath;
    }

    summary.updatedAt = new Date().toISOString();
    summary.checkpoints.push({
      recordedAt: new Date().toISOString(),
      status: "probe-complete",
      observedUrl: summary.finalUrl,
      title: summary.title,
    });

    writeSession(filePath, summary);

    return {
      ok: true,
      message: [
        "Co-browser probe completed.",
        `- Path: Playwright automation`,
        `- Session: ${name}`,
        `- Browser: ${summary.browser}`,
        `- Start URL: ${summary.startUrl}`,
        `- Final URL: ${summary.finalUrl}`,
        `- Title: ${summary.title || "(none)"}`,
        `- Wait selector: ${summary.waitForSelector ? `${summary.waitForSelector} (${summary.waitForSelectorFound ? "found" : "not found"})` : "not requested"}`,
        `- Expected text: ${summary.expectedText ? `${summary.expectedText} (${summary.expectedTextPresent ? "present" : "absent"})` : "not requested"}`,
        `- Text preview: ${previewText(summary.bodyText)}`,
        `- Screenshot: ${summary.screenshotPath || "not captured"}`,
        `- Session file: ${filePath}`,
      ].join("\n"),
    };
  } catch (error) {
    summary.updatedAt = new Date().toISOString();
    summary.finalUrl = page.url();
    summary.title = await page.title().catch(() => null);
    summary.error = String(error?.message || error);
    writeSession(filePath, summary);
    return {
      ok: false,
      message: [
        "Co-browser probe failed.",
        `- Path: Playwright automation`,
        `- Session: ${name}`,
        `- Browser: ${summary.browser}`,
        `- Start URL: ${summary.startUrl}`,
        `- Final URL: ${summary.finalUrl || "(unavailable)"}`,
        `- Error: ${summary.error}`,
        `- Session file: ${filePath}`,
      ].join("\n"),
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function isCdpEndpointReady(endpoint) {
  try {
    const response = await fetch(`${endpoint}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCdpEndpoint(endpoint, timeoutMs = 10000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) {
        return true;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error(`CDP endpoint did not become ready at ${endpoint} within ${timeoutMs}ms${lastError?.message ? ` (${lastError.message})` : ""}.`);
}

function resolveUserDataDir(sessionDir, name, requestedPath) {
  const sessionNameValidation = validateSessionNameComponent(name, {
    source: "cobrowser_launch_debug_edge",
  });
  if (!sessionNameValidation.ok) {
    return {
      ok: false,
      reason: sessionNameValidation.reason,
    };
  }

  if (!requestedPath) {
    return {
      ok: true,
      resolvedPath: join(sessionDir, slugify(sessionNameValidation.sessionName), "profile", "default"),
    };
  }

  const allowedRoot = resolve(sessionDir, slugify(sessionNameValidation.sessionName), "profile");
  const rootCheck = resolvePathWithinRoot(allowedRoot, requestedPath, {
    source: "cobrowser_launch_debug_edge",
    detailKey: "userDataDir",
    message: "user_data_dir must resolve under data/sessions/<session>/profile",
  });

  if (!rootCheck.ok || rootCheck.relativePath === "") {
    return {
      ok: false,
      reason: "user_data_dir must resolve under data/sessions/<session>/profile",
    };
  }

  return {
    ok: true,
    resolvedPath: rootCheck.resolvedPath,
  };
}

async function launchDebugEdgeBrowser(sessionDir, args) {
  const detection = detectBrowser("msedge");
  if (!detection) {
    return {
      ok: false,
      message: "Microsoft Edge was not found on this machine.",
    };
  }

  const urlValidation = validateUrl(args.url, { source: "cobrowser_launch_debug_edge" });
  if (!urlValidation.ok) {
    return {
      ok: false,
      message: `URL rejected: ${urlValidation.reason}`,
    };
  }

  const debugPortValidation = validateDebugPort(args.debug_port);
  if (!debugPortValidation.ok) {
    return {
      ok: false,
      message: debugPortValidation.reason,
    };
  }

  const debugPort = debugPortValidation.debugPort;
  const endpointValidation = normalizeCdpEndpoint({
    debug_port: debugPort,
    cdp_endpoint: args.cdp_endpoint,
    source: "cobrowser_launch_debug_edge",
  });
  if (!endpointValidation.ok) {
    return {
      ok: false,
      message: endpointValidation.reason,
    };
  }
  const endpoint = endpointValidation.normalizedEndpoint;

  if (await isCdpEndpointReady(endpoint)) {
    return {
      ok: false,
      message: [
        "A debug-enabled browser is already listening on the requested CDP endpoint.",
        `- Path: Debug-enabled Edge launch`,
        `- CDP endpoint: ${endpoint}`,
        `- Next step: Use cobrowser_attach_tab with this debug_port, or choose a different debug_port for a fresh window.`,
      ].join("\n"),
    };
  }

  const name = args.name || `debug-edge-${debugPort}`;
  const filePath = sessionFile(sessionDir, name);
  const userDataDirResult = resolveUserDataDir(sessionDir, name, args.user_data_dir || null);
  if (!userDataDirResult.ok) {
    return {
      ok: false,
      message: userDataDirResult.reason,
    };
  }

  const userDataDir = userDataDirResult.resolvedPath;
  ensureDir(userDataDir);

  const launchArgs = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];

  if (args.new_window !== false) {
    launchArgs.push("--new-window");
  }

  launchArgs.push("--", urlValidation.normalizedUrl);

  const child = spawn(detection.executablePath, launchArgs, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
    shell: false,
  });
  child.unref();

  try {
    await waitForCdpEndpoint(endpoint, Number(args.launch_timeout_ms || 10000));
  } catch (error) {
    if (child.pid) {
      try {
        process.kill(child.pid);
      } catch {
        // Best-effort cleanup only.
      }
    }

    return {
      ok: false,
      message: [
        "Debug-enabled Edge launch failed.",
        `- Path: Debug-enabled Edge launch`,
        `- URL: ${urlValidation.normalizedUrl}`,
        `- CDP endpoint: ${endpoint}`,
        `- User data dir: ${userDataDir}`,
        `- Error: ${String(error?.message || error)}`,
      ].join("\n"),
    };
  }

  const payload = {
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: "debug-browser-launch",
    browser: detection.browserName,
    executablePath: detection.executablePath,
    targetUrl: urlValidation.normalizedUrl,
    cdpEndpoint: endpoint,
    debugPort,
    userDataDir,
    processId: child.pid || null,
    checkpoints: [],
  };
  writeSession(filePath, payload);

  return {
    ok: true,
    message: [
      "Debug-enabled Edge launched.",
      `- Path: Debug-enabled Edge launch`,
      `- Session: ${name}`,
      `- URL: ${urlValidation.normalizedUrl}`,
      `- Browser: ${detection.browserName}`,
      `- Debug port: ${debugPort}`,
      `- CDP endpoint: ${endpoint}`,
      `- Process ID: ${child.pid || "(unavailable)"}`,
      `- User data dir: ${userDataDir}`,
      `- Session file: ${filePath}`,
      `- Warning: The CDP debug port is loopback-only but remains unauthenticated while the browser is running.`,
      `- Next step: Use cobrowser_attach_tab with debug_port ${debugPort} and a tab filter such as url_contains or exact_url.`,
    ].join("\n"),
  };
}

async function listAttachedPages(browser) {
  const pages = [];

  for (const [contextIndex, context] of browser.contexts().entries()) {
    for (const [pageIndex, page] of context.pages().entries()) {
      const url = page.url();
      const title = await page.title().catch(() => "");
      pages.push({ contextIndex, pageIndex, url, title, page });
    }
  }

  return pages;
}

function matchesAttachedPage(entry, args) {
  if (args.exact_url && entry.url !== args.exact_url) {
    return false;
  }

  if (args.url_contains && !String(entry.url || "").includes(args.url_contains)) {
    return false;
  }

  if (args.title_contains && !String(entry.title || "").toLowerCase().includes(String(args.title_contains).toLowerCase())) {
    return false;
  }

  return true;
}

function formatAttachedPage(entry) {
  return `[${entry.contextIndex}:${entry.pageIndex}] ${entry.title || "(no title)"} | ${entry.url || "(no url)"}`;
}

async function resolveAttachedPage(browser, args) {
  const allPages = (await listAttachedPages(browser))
    .filter((entry) => !String(entry.url || "").startsWith("devtools://"));

  const matches = allPages.filter((entry) => matchesAttachedPage(entry, args));
  const matchIndex = Number.isInteger(args.match_index) ? args.match_index : 0;

  if (matches.length > 0) {
    return { pageEntry: matches[matchIndex] || null, allPages, matches };
  }

  if (!args.exact_url && !args.url_contains && !args.title_contains) {
    if (allPages.length === 1) {
      return { pageEntry: allPages[0], allPages, matches: allPages };
    }

    const httpPages = allPages.filter((entry) => /^https?:/i.test(entry.url || ""));
    if (httpPages.length === 1) {
      return { pageEntry: httpPages[0], allPages, matches: httpPages };
    }
  }

  return { pageEntry: null, allPages, matches };
}

async function runAttachedTabInspection(sessionDir, args) {
  const endpointValidation = normalizeCdpEndpoint({
    debug_port: args.debug_port,
    cdp_endpoint: args.cdp_endpoint,
    source: "cobrowser_attach_tab",
  });
  if (!endpointValidation.ok) {
    return {
      ok: false,
      message: endpointValidation.reason,
    };
  }

  const endpoint = endpointValidation.normalizedEndpoint;
  const name = args.name || `attach-${slugify(args.url_contains || args.title_contains || args.exact_url || endpoint)}`;
  const filePath = sessionFile(sessionDir, name);
  const evidenceDir = join(sessionDir, slugify(name));
  ensureDir(evidenceDir);

  const timeout = Number(args.timeout_ms || 15000);
  const summary = {
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    mode: "playwright-attached-tab",
    cdpEndpoint: endpoint,
    exactUrl: args.exact_url || null,
    urlContains: args.url_contains || null,
    titleContains: args.title_contains || null,
    waitForSelector: args.wait_for_selector || null,
    waitForSelectorFound: null,
    expectedText: args.expected_text || null,
    expectedTextPresent: null,
    scrollPageCount: Number(args.scroll_page_count || 0),
    finalUrl: null,
    title: null,
    selectedPage: null,
    availablePages: [],
    extractedText: null,
    screenshotPath: null,
    checkpoints: [],
  };

  let browser;

  try {
    browser = await chromium.connectOverCDP(endpoint);
    const selection = await resolveAttachedPage(browser, args);
    summary.availablePages = selection.allPages.map((entry) => ({
      contextIndex: entry.contextIndex,
      pageIndex: entry.pageIndex,
      title: entry.title || null,
      url: entry.url || null,
    }));

    if (!selection.pageEntry) {
      writeSession(filePath, summary);
      return {
        ok: false,
        message: [
          "Could not attach to a unique browser tab.",
          `- Path: Playwright attached tab`,
          `- CDP endpoint: ${endpoint}`,
          `- Filter exact URL: ${args.exact_url || "(none)"}`,
          `- Filter URL contains: ${args.url_contains || "(none)"}`,
          `- Filter title contains: ${args.title_contains || "(none)"}`,
          ...summary.availablePages.slice(0, 12).map((entry) => `- Available tab: ${formatAttachedPage(entry)}`),
          `- Session file: ${filePath}`,
        ].join("\n"),
      };
    }

    const page = selection.pageEntry.page;
    summary.selectedPage = {
      contextIndex: selection.pageEntry.contextIndex,
      pageIndex: selection.pageEntry.pageIndex,
      title: selection.pageEntry.title || null,
      url: selection.pageEntry.url || null,
    };

    await page.bringToFront().catch(() => {});

    if (args.wait_for_selector) {
      try {
        await page.waitForSelector(args.wait_for_selector, { timeout });
        summary.waitForSelectorFound = true;
      } catch {
        summary.waitForSelectorFound = false;
      }
    }

    const scrollCount = Number(args.scroll_page_count || 0);
    for (let index = 0; index < scrollCount; index += 1) {
      await page.keyboard.press("PageDown");
      await page.waitForTimeout(250);
    }

    try {
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 3000) });
    } catch {
      // Network idle is useful but not mandatory.
    }

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (args.expected_text) {
      summary.expectedTextPresent = bodyText.includes(args.expected_text);
    }

    if (args.extract_text !== false) {
      const maxTextChars = Math.max(250, Number(args.max_text_chars || 4000));
      summary.extractedText = wrapUntrusted(bodyText.slice(0, maxTextChars));
    }

    summary.finalUrl = page.url();
    summary.title = await page.title().catch(() => summary.selectedPage?.title || null);

    const screenshotResult = resolveManagedPath(
      sessionDir,
      args.screenshot_path,
      join(evidenceDir, `${slugify(name)}-${nowStamp()}.png`),
      {
        source: "cobrowser_attach_tab",
        detailKey: "screenshotPath",
        message: "screenshot_path must stay inside data/sessions/",
      },
    );
    if (!screenshotResult.ok) {
      return {
        ok: false,
        message: screenshotResult.reason,
      };
    }

    if (args.capture_screenshot !== false) {
      ensureDir(dirname(screenshotResult.resolvedPath));
      await page.screenshot({ path: screenshotResult.resolvedPath, fullPage: true });
      summary.screenshotPath = screenshotResult.resolvedPath;
    }

    summary.updatedAt = new Date().toISOString();
    summary.checkpoints.push({
      recordedAt: new Date().toISOString(),
      status: "attached-tab-inspection-complete",
      observedUrl: summary.finalUrl,
      title: summary.title,
    });

    writeSession(filePath, summary);

    return {
      ok: true,
      message: [
        "Co-browser attached-tab inspection completed.",
        `- Path: Playwright attached tab`,
        `- Session: ${name}`,
        `- CDP endpoint: ${endpoint}`,
        `- Selected tab: ${formatAttachedPage(summary.selectedPage)}`,
        `- Final URL: ${summary.finalUrl}`,
        `- Title: ${summary.title || "(none)"}`,
        `- Wait selector: ${summary.waitForSelector ? `${summary.waitForSelector} (${summary.waitForSelectorFound ? "found" : "not found"})` : "not requested"}`,
        `- Expected text: ${summary.expectedText ? `${summary.expectedText} (${summary.expectedTextPresent ? "present" : "absent"})` : "not requested"}`,
        `- Scroll pages: ${summary.scrollPageCount}`,
        `- Text preview: ${previewText(summary.extractedText)}`,
        `- Screenshot: ${summary.screenshotPath || "not captured"}`,
        `- Session file: ${filePath}`,
      ].join("\n"),
    };
  } catch (error) {
    summary.updatedAt = new Date().toISOString();
    summary.error = String(error?.message || error);
    writeSession(filePath, summary);
    return {
      ok: false,
      message: [
        "Co-browser attached-tab inspection failed.",
        `- Path: Playwright attached tab`,
        `- CDP endpoint: ${endpoint}`,
        `- Error: ${summary.error}`,
        `- Session file: ${filePath}`,
      ].join("\n"),
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function captureGuidedScreenshot(sessionDir, args) {
  if (!isWindows) {
    return {
      ok: false,
      message: "Guided-session screenshot capture is currently implemented for Windows only.",
    };
  }

  const captureModeValidation = validateCaptureMode(args.capture_mode);
  if (!captureModeValidation.ok) {
    return {
      ok: false,
      message: captureModeValidation.reason,
    };
  }

  const evidenceDir = join(sessionDir, slugify(args.name));
  ensureDir(evidenceDir);

  const screenshotResult = resolveManagedPath(
    sessionDir,
    args.screenshot_path,
    join(evidenceDir, `${slugify(args.name)}-${slugify(args.step || "checkpoint")}-${nowStamp()}.png`),
    {
      source: "cobrowser_capture_screenshot",
      detailKey: "screenshotPath",
      message: "screenshot_path must stay inside data/sessions/",
    },
  );
  if (!screenshotResult.ok) {
    return {
      ok: false,
      message: screenshotResult.reason,
    };
  }

  ensureDir(dirname(screenshotResult.resolvedPath));
  await captureWindowsScreenshot(screenshotResult.resolvedPath, captureModeValidation.captureMode);

  let updatedSessionPath;
  try {
    updatedSessionPath = appendCheckpoint(sessionDir, {
      ...args,
      status: args.status || "screenshot-captured",
      screenshot_path: screenshotResult.resolvedPath,
    });
  } catch (error) {
    return {
      ok: false,
      message: String(error?.message || error),
    };
  }

  return {
    ok: true,
    message: [
      "Co-browser screenshot captured.",
      `- Session: ${args.name}`,
      `- Step: ${args.step || "checkpoint"}`,
      `- Capture mode: ${captureModeValidation.captureMode}`,
      `- Screenshot: ${screenshotResult.resolvedPath}`,
      `- Session file: ${updatedSessionPath}`,
    ].join("\n"),
  };
}

export function createCobrowserTools(sessionDir) {
  ensureDir(sessionDir);

  return [
    {
      name: "cobrowser_open_tab",
      description:
        "Open a URL in the user's browser and create a durable co-browser session record. Use this for guided browser walkthroughs, authenticated flows, and visible tab handoff.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Session name, e.g. 'portal-login' or 'checkout-bug'." },
          url: { type: "string", description: "Absolute URL to open." },
          environment: { type: "string", description: "Optional environment label such as prod, dev, or test." },
          goal: { type: "string", description: "Optional success condition for the walkthrough." },
          open_browser: { type: "boolean", description: "Whether to open the browser. Defaults to true." },
        },
        required: ["name", "url"],
      },
      handler: async (args) => {
        const urlValidation = validateUrl(args.url, { source: "cobrowser_open_tab" });
        if (!urlValidation.ok) {
          return `URL rejected: ${urlValidation.reason}`;
        }

        const filePath = sessionFile(sessionDir, args.name);
        const payload = {
          name: args.name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          mode: "guided-browser",
          environment: args.environment || null,
          goal: args.goal || null,
          targetUrl: urlValidation.normalizedUrl,
          checkpoints: [],
        };
        writeSession(filePath, payload);

        let browserError = null;
        if (args.open_browser !== false) {
          const openResult = openBrowser(urlValidation.normalizedUrl);
          if (!openResult.ok) {
            browserError = openResult.reason;
          }
        }

        return [
          browserError ? "Co-browser session recorded, but browser launch failed." : "Co-browser tab prepared.",
          `- Path: Guided browser session`,
          `- Session: ${args.name}`,
          `- URL: ${urlValidation.normalizedUrl}`,
          `- Environment: ${args.environment || "(unspecified)"}`,
          `- Goal: ${args.goal || "(unspecified)"}`,
          `- Session file: ${filePath}`,
          `- Browser opened: ${args.open_browser !== false && !browserError ? "yes" : "no"}`,
          ...(browserError ? [`- Browser error: ${browserError}`] : []),
        ].join("\n");
      },
    },
    {
      name: "cobrowser_probe",
      description:
        "Run a one-shot Playwright inspection against a URL using the user's installed Edge or Chrome. Captures final URL, title, optional selector/text checks, and an evidence screenshot.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional session name for the probe." },
          url: { type: "string", description: "Absolute URL to inspect." },
          browser: { type: "string", enum: ["auto", "msedge", "chrome"], description: "Preferred local browser channel. Defaults to auto." },
          wait_for_selector: { type: "string", description: "Optional CSS selector to wait for before evaluating the page." },
          expected_text: { type: "string", description: "Optional text that should appear in the page body." },
          timeout_ms: { type: "number", description: "Timeout for navigation and checks. Defaults to 15000." },
          show_browser: { type: "boolean", description: "If true, runs headed instead of headless." },
          capture_screenshot: { type: "boolean", description: "Whether to capture a screenshot. Defaults to true." },
          screenshot_path: { type: "string", description: "Optional absolute screenshot path." },
          ignore_https_errors: { type: "boolean", description: "Dangerous: ignore TLS certificate errors when needed for internal environments." },
        },
        required: ["url"],
      },
      handler: async (args) => {
        const result = await runPlaywrightProbe(sessionDir, args);
        return result.message;
      },
    },
    {
      name: "cobrowser_launch_debug_edge",
      description:
        "Launch a fresh debug-enabled Microsoft Edge window with a remote-debugging port so Playwright can attach to its tabs afterward.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional session name for the launched debug browser." },
          url: { type: "string", description: "Absolute URL to open in the new debug-enabled Edge window." },
          debug_port: { type: "number", description: "Optional remote debugging port. Defaults to 9222." },
          cdp_endpoint: { type: "string", description: "Optional CDP endpoint override such as http://127.0.0.1:9222." },
          user_data_dir: { type: "string", description: "Optional absolute user-data directory for the debug browser profile." },
          launch_timeout_ms: { type: "number", description: "How long to wait for the CDP endpoint. Defaults to 10000." },
          new_window: { type: "boolean", description: "Whether to request a new Edge window. Defaults to true." }
        },
        required: ["url"],
      },
      handler: async (args) => {
        const result = await launchDebugEdgeBrowser(sessionDir, args);
        return result.message;
      },
    },
    {
      name: "cobrowser_attach_tab",
      description:
        "Attach Playwright to an existing debug-enabled Edge or Chrome tab via CDP, optionally scroll it, extract page text, and capture a screenshot. Requires the browser to be started with --remote-debugging-port.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Optional session name for the attached-tab inspection." },
          cdp_endpoint: { type: "string", description: "Optional CDP endpoint such as http://127.0.0.1:9222. Defaults to the local debug port." },
          debug_port: { type: "number", description: "Optional local debugging port when cdp_endpoint is not provided. Defaults to 9222." },
          exact_url: { type: "string", description: "Optional exact page URL to attach to." },
          url_contains: { type: "string", description: "Optional substring used to match the target tab URL." },
          title_contains: { type: "string", description: "Optional substring used to match the target tab title." },
          match_index: { type: "number", description: "Optional zero-based match index when multiple tabs satisfy the filters." },
          wait_for_selector: { type: "string", description: "Optional CSS selector to wait for after attaching." },
          expected_text: { type: "string", description: "Optional text that should appear in the attached page body." },
          timeout_ms: { type: "number", description: "Timeout for checks after attaching. Defaults to 15000." },
          scroll_page_count: { type: "number", description: "Optional number of PageDown presses to send before extracting text and screenshotting." },
          extract_text: { type: "boolean", description: "Whether to extract page text. Defaults to true." },
          max_text_chars: { type: "number", description: "Maximum extracted text characters to persist. Defaults to 4000." },
          capture_screenshot: { type: "boolean", description: "Whether to capture a screenshot. Defaults to true." },
          screenshot_path: { type: "string", description: "Optional absolute screenshot path." },
        },
      },
      handler: async (args) => {
        const result = await runAttachedTabInspection(sessionDir, args);
        return result.message;
      },
    },
    {
      name: "cobrowser_checkpoint",
      description:
        "Record a manual checkpoint in a co-browser session after the user or agent completes a browser step. Use this especially for authenticated enterprise flows and manual approval boundaries.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Session name created by cobrowser_open_tab or cobrowser_probe." },
          step: { type: "string", description: "Short label for the current browser step." },
          status: { type: "string", description: "Suggested values: verified, blocked, manual-step, could-not-verify." },
          observed_url: { type: "string", description: "Observed URL after the step." },
          state_summary: { type: "string", description: "Short description of visible state." },
          expected_outcome: { type: "string", description: "Expected result for this step." },
          actual_outcome: { type: "string", description: "Observed result for this step." },
          error_text: { type: "string", description: "Any visible error text or failure message." },
          screenshot_path: { type: "string", description: "Optional path to a screenshot captured outside the tool." },
          next_step: { type: "string", description: "Suggested next action after this checkpoint." },
        },
        required: ["name", "step", "state_summary"],
      },
      handler: async (args) => {
        try {
          const filePath = appendCheckpoint(sessionDir, args);
          return [
            "Co-browser checkpoint recorded.",
            `- Session: ${args.name}`,
            `- Step: ${args.step}`,
            `- Status: ${args.status || "recorded"}`,
            `- Session file: ${filePath}`,
          ].join("\n");
        } catch (error) {
          return String(error?.message || error);
        }
      },
    },
    {
      name: "cobrowser_capture_screenshot",
      description:
        "Capture a screenshot during a guided co-browser session and record it as a checkpoint. On Windows, ask the user to focus the correct browser window first when using active-window mode.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Session name created by cobrowser_open_tab or cobrowser_probe." },
          step: { type: "string", description: "Short label for the browser step being captured." },
          state_summary: { type: "string", description: "Short description of what is visible in the browser right now." },
          capture_mode: { type: "string", enum: ["active-window", "screen"], description: "Capture the active window or the full screen. Defaults to active-window." },
          observed_url: { type: "string", description: "Observed URL after the manual step, if known." },
          expected_outcome: { type: "string", description: "Expected result for this step." },
          actual_outcome: { type: "string", description: "Observed result for this step." },
          error_text: { type: "string", description: "Any visible error text." },
          screenshot_path: { type: "string", description: "Optional absolute path for the screenshot PNG." },
          status: { type: "string", description: "Suggested values: verified, blocked, screenshot-captured." },
          next_step: { type: "string", description: "Suggested next action after the screenshot is captured." },
        },
        required: ["name", "step", "state_summary"],
      },
      handler: async (args) => {
        const result = await captureGuidedScreenshot(sessionDir, args);
        return result.message;
      },
    },
    {
      name: "cobrowser_list_sessions",
      description: "List saved co-browser sessions and the most recent update time for each one.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const files = readdirSync(sessionDir)
          .filter((entry) => entry.endsWith(".json"))
          .map((entry) => {
            const path = join(sessionDir, entry);
            const session = readSession(path);
            return {
              name: session?.name || entry,
              mode: session?.mode || "unknown",
              updatedAt: session?.updatedAt || session?.createdAt || statSync(path).mtime.toISOString?.() || null,
              targetUrl: session?.targetUrl || session?.startUrl || session?.finalUrl || null,
              filePath: path,
            };
          })
          .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));

        if (files.length === 0) {
          return "No co-browser sessions are recorded.";
        }

        return files
          .map((entry) => `- ${entry.name} | ${entry.mode} | ${entry.updatedAt || "(unknown time)"} | ${entry.targetUrl || "(no URL)"} | ${entry.filePath}`)
          .join("\n");
      },
    },
    {
      name: "cobrowser_clear_session",
      description: "Delete a saved co-browser session file and its evidence folder when cleanup is needed.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Session name to remove." },
        },
        required: ["name"],
      },
      handler: async (args) => {
        const sessionNameValidation = validateSessionNameComponent(args.name, {
          source: "cobrowser_clear_session",
        });
        if (!sessionNameValidation.ok) {
          return `Session name rejected: ${sessionNameValidation.reason}`;
        }

        const sessionName = sessionNameValidation.sessionName;
        const filePath = sessionFile(sessionDir, sessionName);
        const evidenceDir = join(sessionDir, slugify(sessionName));
        if (existsSync(filePath)) {
          rmSync(filePath, { force: true });
        }
        if (existsSync(evidenceDir)) {
          rmSync(evidenceDir, { recursive: true, force: true });
        }
        return `Co-browser session '${sessionName}' removed.`;
      },
    },
  ];
}
