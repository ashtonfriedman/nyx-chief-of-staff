// Canvas server — local HTTP server with SSE live reload and action back-channel.

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, sep } from "node:path";
import { randomBytes } from "node:crypto";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

/** Bridge script injected into HTML responses — token-aware. */
function getBridgeScript(token) {
  return `
<script>
(function() {
  var es = new EventSource('/_sse?token=${token}');
  es.onmessage = function(e) {
    if (e.data === 'reload') { location.reload(); }
    if (e.data === 'close') { window.close(); }
  };
  window.canvas = {
    sendAction: function(name, data) {
      return fetch('/_action?token=${token}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name, data: data || {}, timestamp: Date.now() })
      });
    }
  };
})();
</script>`;
}

/**
 * Create and manage a canvas HTTP server.
 * @param {string} contentDir - Directory to serve files from
 * @param {function} onAction - Callback when a user action is received
 * @returns {object} Server controller
 */
export function createCanvasServer(contentDir, onAction) {
  let server = null;
  let port = null;
  let sseClients = [];
  const authToken = randomBytes(16).toString("hex");
  const MAX_BODY = 64 * 1024; // 64KB

  function checkAuth(req, res) {
    const url = new URL(req.url, `http://127.0.0.1`);
    if (url.searchParams.get("token") !== authToken) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return false;
    }
    return true;
  }

  function handleRequest(req, res) {
    // SSE endpoint — requires auth token
    if (req.url.startsWith("/_sse")) {
      if (!checkAuth(req, res)) return;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write("data: connected\n\n");
      sseClients.push(res);
      // Evict oldest if over limit
      while (sseClients.length > 10) {
        const evicted = sseClients.shift();
        try { evicted.end(); } catch { /* already gone */ }
      }
      req.on("close", () => {
        sseClients = sseClients.filter((c) => c !== res);
      });
      return;
    }

    // Action back-channel — requires auth token, body size limited
    if (req.url.startsWith("/_action") && req.method === "POST") {
      if (!checkAuth(req, res)) return;
      let body = "";
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) {
          req.destroy();
          res.writeHead(413);
          res.end('{"error":"payload too large"}');
          return;
        }
        body += chunk;
      });
      req.on("end", () => {
        try {
          const action = JSON.parse(body);
          if (onAction) onAction(action);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end('{"ok":true}');
        } catch {
          res.writeHead(400);
          res.end('{"error":"invalid json"}');
        }
      });
      return;
    }

    // Static file serving
    let filePath = req.url === "/" ? "/index.html" : req.url;
    filePath = filePath.split("?")[0]; // strip query params
    const fullPath = join(contentDir, filePath);

    // Path traversal protection
    if (fullPath !== contentDir && !fullPath.startsWith(contentDir + sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (!existsSync(fullPath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    try {
      let content = readFileSync(fullPath);
      const ext = extname(fullPath).toLowerCase();
      const mime = MIME_TYPES[ext] || "application/octet-stream";

      // Inject bridge script into HTML responses
      if (ext === ".html") {
        let html = content.toString("utf-8");
        const bridgeScript = getBridgeScript(authToken);
        if (html.includes("</body>")) {
          html = html.replace("</body>", `${bridgeScript}\n</body>`);
        } else if (html.includes("</html>")) {
          html = html.replace("</html>", `${bridgeScript}\n</html>`);
        } else {
          html += bridgeScript;
        }
        content = html;
      }

      res.writeHead(200, {
        "Content-Type": mime,
        "Cache-Control": "no-store",
      });
      res.end(content);
    } catch {
      res.writeHead(500);
      res.end("Server error");
    }
  }

  return {
    /** Start the server. @param {number} [fixedPort] - specific port, or 0/undefined for random */
    start(fixedPort) {
      return new Promise((resolve, reject) => {
        if (server) {
          resolve(port);
          return;
        }
        server = createServer(handleRequest);
        server.listen(fixedPort || 0, "127.0.0.1", () => {
          port = server.address().port;
          resolve(port);
        });
        server.on("error", reject);
      });
    },

    /** Push an SSE reload event to all connected clients. */
    reload() {
      for (const client of sseClients) {
        try {
          client.write("data: reload\n\n");
        } catch { /* client disconnected */ }
      }
    },

    /** Push an SSE close event to all connected clients. */
    closeClients() {
      for (const client of sseClients) {
        try {
          client.write("data: close\n\n");
        } catch { /* client disconnected */ }
      }
    },

    /** Stop the server. */
    stop() {
      return new Promise((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        // Close all SSE connections
        for (const client of sseClients) {
          try { client.end(); } catch { /* ok */ }
        }
        sseClients = [];
        server.close(() => {
          server = null;
          port = null;
          resolve();
        });
      });
    },

    /** Get the auth token for URL construction. */
    getToken() { return authToken; },

    /** Get the current port (null if not running). */
    getPort() { return port; },

    /** Check if server is running. */
    isRunning() { return server !== null; },
  };
}
