#!/usr/bin/env node
// refresh-server.js — Static file server + refresh API for team-dashboard.
// Replaces `canvas_show`. Serves on localhost:9999.
// Security: binds to 127.0.0.1 only, no dotfile access, no directory traversal.
"use strict";

const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const { spawn, execSync } = require('child_process');

// Resolve Python — Windows App Execution Aliases are stubs that fail in child_process
function findPython() {
  for (const cmd of ['python3', 'python', 'py']) {
    try {
      const v = execSync(`${cmd} --version`, { stdio: 'pipe', timeout: 5000 }).toString().trim();
      if (v.startsWith('Python')) return cmd;
    } catch (_) { /* next */ }
  }
  // Fallback: common Windows install path
  const local = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'python.exe');
  if (fs.existsSync(local)) return local;
  return 'python';  // let it fail with a clear error
}
const PYTHON = findPython();

const PORT       = process.env.PORT || 9999;
const HOST       = '127.0.0.1';
const ROOT       = __dirname;
const CSRF_TOKEN = crypto.randomBytes(32).toString('hex');
const COLLECT_TIMEOUT_MS = 600_000;
const MAX_SSE_CLIENTS    = 10;

// --- Security headers applied to every response ---
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'");
}

// --- Single-flight lock: only one collect+normalize run at a time --------
let refreshState = {
  running: false,
  progress: { n: 0, total: 0, phase: 'idle', msg: '' },
  clients: [],            // SSE response objects (one per open browser tab)
};

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  refreshState.clients = refreshState.clients.filter(res => {
    try { res.write(payload); return true; }
    catch (_) { return false; }   // prune closed connections
  });
}

function startRefresh() {
  if (refreshState.running) {
    broadcast('status', { running: true, msg: 'Already running — attaching to existing stream' });
    return;
  }
  refreshState.running = true;
  refreshState.progress = { n: 0, total: 0, phase: 'collect', msg: 'Starting collector…' };
  broadcast('start', refreshState.progress);

  // Phase 1: collect.py
  const collector = spawn(PYTHON, ['collect.py', '--include-prs'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });

  let collectorStderr = '';

  const collectTimer = setTimeout(() => {
    collector.kill();
    refreshState.running = false;
    broadcast('error', { msg: 'collect.py timed out after 10 minutes' });
  }, COLLECT_TIMEOUT_MS);

  collector.stderr.on('data', chunk => {
    collectorStderr += chunk.toString();
    // Progress lines look like: [12/130] Fetching work items…
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      const m = line.match(/\[(\d+)\/(\d+)\]/);
      if (m) {
        refreshState.progress = { n: +m[1], total: +m[2], phase: 'collect', msg: line.trim() };
        broadcast('progress', refreshState.progress);
      } else {
        broadcast('log', { msg: line.trim() });
      }
    }
  });

  collector.on('close', code => {
    clearTimeout(collectTimer);
    if (code !== 0) {
      const lastLine = collectorStderr.split('\n').filter(Boolean).pop() || '';
      refreshState.running = false;
      broadcast('error', { msg: `collect.py exited with code ${code}: ${lastLine}` });
      return;
    }

    // Phase 2: normalize.js
    broadcast('progress', { n: 0, total: 1, phase: 'normalize', msg: 'Normalizing data…' });
    const normalizer = spawn('node', ['normalize.js'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    });

    normalizer.stderr.on('data', chunk => {
      broadcast('log', { msg: chunk.toString().trim() });
    });

    normalizer.stdout.on('data', chunk => {
      broadcast('log', { msg: chunk.toString().trim() });
    });

    normalizer.on('close', code2 => {
      if (code2 !== 0) {
        refreshState.running = false;
        broadcast('error', { msg: `normalize.js exited with code ${code2}` });
        return;
      }

      // Phase 3: snapshot-velocity.js
      broadcast('progress', { n: 0, total: 1, phase: 'snapshot', msg: 'Updating velocity snapshots…' });
      const snapshotter = spawn('node', ['snapshot-velocity.js'], {
        cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      });

      snapshotter.stdout.on('data', chunk => {
        broadcast('log', { msg: chunk.toString().trim() });
      });
      snapshotter.stderr.on('data', chunk => {
        broadcast('log', { msg: chunk.toString().trim() });
      });

      snapshotter.on('close', code3 => {
        refreshState.running = false;
        if (code3 !== 0) {
          broadcast('error', { msg: `snapshot-velocity.js exited with code ${code3}` });
        } else {
          broadcast('complete', { msg: 'Data refreshed successfully' });
        }
      });
    });
  });
}

// --- MIME types -----------------------------------------------------------
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.map':  'application/json',
  '.ico':  'image/x-icon',
};

function safePath(urlPath) {
  // Resolve against ROOT, reject traversal and dotfiles
  const rel = path.normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const abs = path.join(ROOT, rel);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;  // traversal
  const parts = rel.split(path.sep);
  if (parts.some(p => p.startsWith('.'))) return null;                // dotfiles
  return abs;
}

// --- HTTP server ----------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);

  // --- API: SSE refresh stream ---
  if (url.pathname === '/api/refresh' && req.method === 'GET') {
    setSecurityHeaders(res);
    const token = url.searchParams.get('token');
    if (token !== CSRF_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: invalid CSRF token');
      return;
    }
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    });
    res.write(':ok\n\n');
    if (refreshState.clients.length >= MAX_SSE_CLIENTS) {
      const oldest = refreshState.clients.shift();
      try { oldest.end(); } catch (_) {}
    }
    refreshState.clients.push(res);
    req.on('close', () => {
      refreshState.clients = refreshState.clients.filter(c => c !== res);
    });
    if (!refreshState.running) startRefresh();
    return;
  }

  // --- API: status (for polling fallback) ---
  if (url.pathname === '/api/status' && req.method === 'GET') {
    setSecurityHeaders(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ running: refreshState.running, progress: refreshState.progress }));
    return;
  }

  // --- Static files --------------------------------------------------------
  let filePath = url.pathname === '/' ? '/team-dashboard.html' : url.pathname;
  filePath = safePath(filePath);

  if (!filePath) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  // Directory → try index
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'team-dashboard.html');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found: ' + url.pathname); return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    setSecurityHeaders(res);
    // Inject CSRF token into HTML pages so client JS can read it
    if (ext === '.html') {
      const html = data.toString('utf8').replace(
        '</head>',
        `<meta name="csrf-token" content="${CSRF_TOKEN}">\n</head>`
      );
      res.writeHead(200, { 'Content-Type': mime });
      res.end(html);
    } else {
      res.writeHead(200, { 'Content-Type': mime });
      res.end(data);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[refresh-server] http://${HOST}:${PORT}/`);
  console.log(`[refresh-server] serving from ${ROOT}`);
});
