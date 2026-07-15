/**
 * Action-capable dashboard server.
 * Serves static files from the content directory and exposes a REST API
 * for the action queue (incident triage from the incidents tab).
 *
 * Binds 127.0.0.1 only. No network exposure.
 *
 * Routes:
 *   GET  /                  → daily-dashboard-v2.html
 *   GET  /*.html|*.json     → static file from content dir
 *   GET  /api/actions       → current action queue
 *   POST /api/actions       → enqueue a new action
 *   DELETE /api/actions/:id → remove a processed action
 *   PATCH  /api/actions/:id → update action status/result
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.DASHBOARD_PORT || '9999', 10);
const HOST = '127.0.0.1';
const CONTENT_DIR = path.join(__dirname, '..', '..', 'extensions', 'canvas', 'data', 'content');
const QUEUE_PATH = path.join(CONTENT_DIR, 'action-queue.json');
const MAX_QUEUE_SIZE = 100;
const MAX_BODY_BYTES = 4096;

// MIME types for static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// ── Queue helpers ───────────────────────────────────────────────────────────

function readQueue() {
  try {
    const raw = fs.readFileSync(QUEUE_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.actions)) throw new Error('malformed');
    return data;
  } catch (err) {
    console.error('[queue] Corrupted queue file:', err.message, '— resetting to empty');
    return { actions: [] };
  }
}

function writeQueue(data) {
  if (fs.existsSync(QUEUE_PATH)) {
    fs.copyFileSync(QUEUE_PATH, QUEUE_PATH + '.bak');
  }
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

const LOCK_PATH = QUEUE_PATH + '.lock';

function withQueueLock(fn) {
  let lockFd;
  try {
    lockFd = fs.openSync(LOCK_PATH, 'wx'); // exclusive create — fails if exists
  } catch (e) {
    if (e.code === 'EEXIST') {
      // Check if lock is stale (>10s old)
      try {
        const stat = fs.statSync(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > 10000) {
          fs.unlinkSync(LOCK_PATH);
          lockFd = fs.openSync(LOCK_PATH, 'wx');
        } else {
          throw new Error('Queue is locked by another operation');
        }
      } catch (inner) {
        throw new Error('Queue is locked by another operation');
      }
    } else {
      throw e;
    }
  }
  try {
    return fn();
  } finally {
    try { fs.closeSync(lockFd); } catch {}
    try { fs.unlinkSync(LOCK_PATH); } catch {}
  }
}

// ── Request validation ───────────────────────────────────────────────────────

function isRequestAllowed(req) {
  const origin = req.headers['origin'];
  const referer = req.headers['referer'];
  // CLI agent / curl sends no origin/referer — allow
  if (!origin && !referer) return true;
  // Browser requests: only allow from this server itself
  const allowed = `http://${HOST}:${PORT}`;
  if (origin && !origin.startsWith(allowed)) return false;
  if (referer && !referer.startsWith(allowed)) return false;
  return true;
}

// ── Request body parser ─────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ── Validation ──────────────────────────────────────────────────────────────

const VALID_TYPES = new Set([
  'open_portal', 'queue_resolve', 'queue_acknowledge'
]);

const VALID_TEMPLATES = new Set(['noise', 'transient', 'real']);

function validateAction(obj) {
  if (!obj || typeof obj !== 'object') return 'body must be a JSON object';
  if (!VALID_TYPES.has(obj.type)) return `invalid type: ${obj.type}`;
  if (!Array.isArray(obj.incidentIds) || obj.incidentIds.length === 0) {
    return 'incidentIds must be a non-empty array';
  }
  // Incident IDs must be positive integers (numeric IDs)
  for (const id of obj.incidentIds) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      return `invalid incident ID: ${id}`;
    }
  }
  if (obj.incidentIds.length > 50) return 'max 50 incidents per action';

  // Resolution metadata (Phase 2)
  if (obj.template !== undefined) {
    if (typeof obj.template !== 'string' || !VALID_TEMPLATES.has(obj.template)) {
      return `invalid template: ${obj.template} (must be one of: noise, transient, real)`;
    }
  }
  if (obj.type === 'queue_resolve') {
    if (!obj.template) obj.template = 'noise'; // default
    if (obj.template === 'real' && (!obj.notes || typeof obj.notes !== 'string' || !obj.notes.trim())) {
      return 'notes required when template is real';
    }
  }
  if (obj.notes !== undefined && (typeof obj.notes !== 'string' || obj.notes.length > 2000)) {
    return 'notes must be a string of at most 2000 characters';
  }
  if (obj.rootCauseCategory !== undefined && (typeof obj.rootCauseCategory !== 'string' || obj.rootCauseCategory.length > 200)) {
    return 'rootCauseCategory must be a string of at most 200 characters';
  }

  return null;
}

// ── Route handlers ──────────────────────────────────────────────────────────

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function handleGetActions(req, res) {
  const queue = readQueue();
  sendJson(res, 200, queue);
}

async function handlePostAction(req, res) {
  if (!isRequestAllowed(req)) {
    sendJson(res, 403, { error: 'cross-origin request blocked' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    sendJson(res, 413, { error: e.message });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendJson(res, 400, { error: 'invalid JSON' });
    return;
  }

  const err = validateAction(parsed);
  if (err) {
    sendJson(res, 400, { error: err });
    return;
  }

  try {
    const result = withQueueLock(() => {
      const queue = readQueue();

      // Deduplicate: reject if any incidents are already in pending queue
      const pendingIncidents = new Set(
        queue.actions
          .filter(a => a.status === 'queued' || a.status === 'processing')
          .flatMap(a => a.incidentIds)
      );
      const duplicates = parsed.incidentIds.filter(id => pendingIncidents.has(id));
      if (duplicates.length > 0) {
        return { error: `Incidents already queued: ${duplicates.join(', ')}`, status: 409 };
      }

      // Evict completed/failed actions first; reject if full of pending
      while (queue.actions.length >= MAX_QUEUE_SIZE) {
        const doneIdx = queue.actions.findIndex(a => a.status === 'done' || a.status === 'failed');
        if (doneIdx >= 0) {
          queue.actions.splice(doneIdx, 1);
        } else {
          return { error: 'Action queue full. Wait for agent to process backlog.', status: 503 };
        }
      }

      const action = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: parsed.type,
        incidentIds: parsed.incidentIds,
        template: parsed.template || null,
        notes: parsed.notes || null,
        rootCauseCategory: parsed.rootCauseCategory || null,
        status: 'queued',
        queuedAt: new Date().toISOString(),
        processedAt: null,
        result: null,
      };

      queue.actions.push(action);
      writeQueue(queue);
      return { ok: true, queued: queue.actions.length, actionId: action.id };
    });

    if (result.error) {
      sendJson(res, result.status, { error: result.error });
    } else {
      sendJson(res, 201, result);
    }
  } catch (e) {
    sendJson(res, 503, { error: e.message });
  }
}

function handleDeleteAction(req, res, actionId) {
  if (!isRequestAllowed(req)) {
    sendJson(res, 403, { error: 'cross-origin request blocked' });
    return;
  }

  if (!actionId || typeof actionId !== 'string') {
    sendJson(res, 400, { error: 'missing action ID' });
    return;
  }

  try {
    const result = withQueueLock(() => {
      const queue = readQueue();
      const before = queue.actions.length;
      queue.actions = queue.actions.filter(a => a.id !== actionId);

      if (queue.actions.length === before) {
        return { error: 'action not found', status: 404 };
      }

      writeQueue(queue);
      return { ok: true, remaining: queue.actions.length };
    });

    if (result.error) {
      sendJson(res, result.status, { error: result.error });
    } else {
      sendJson(res, 200, result);
    }
  } catch (e) {
    sendJson(res, 503, { error: e.message });
  }
}

function handlePatchAction(req, res, actionId) {
  if (!isRequestAllowed(req)) {
    sendJson(res, 403, { error: 'cross-origin request blocked' });
    return;
  }

  readBody(req).then(body => {
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { return sendJson(res, 400, { error: 'invalid JSON' }); }

    try {
      const result = withQueueLock(() => {
        const queue = readQueue();
        const action = queue.actions.find(a => a.id === actionId);
        if (!action) return { error: 'action not found', status: 404 };

        // Forward-only state machine
        const TERMINAL = new Set(['done', 'failed']);
        if (TERMINAL.has(action.status)) {
          return { error: `action already in terminal state: ${action.status}`, status: 409 };
        }
        const VALID_TRANSITIONS = {
          queued: new Set(['processing', 'failed']),
          processing: new Set(['done', 'failed']),
        };
        if (parsed.status) {
          if (!VALID_TRANSITIONS[action.status] || !VALID_TRANSITIONS[action.status].has(parsed.status)) {
            return { error: `invalid transition: ${action.status} → ${parsed.status}`, status: 400 };
          }
          action.status = parsed.status;
        }

        if (parsed.status === 'done' || parsed.status === 'failed') {
          action.processedAt = new Date().toISOString();
        }
        if (parsed.result !== undefined) action.result = parsed.result;

        writeQueue(queue);
        return { ok: true, action };
      });

      if (result.error) {
        sendJson(res, result.status, { error: result.error });
      } else {
        sendJson(res, 200, result);
      }
    } catch (e) {
      sendJson(res, 503, { error: e.message });
    }
  }).catch(e => sendJson(res, 413, { error: e.message }));
}

function serveStatic(req, res, urlPath) {
  // Resolve relative to content directory, prevent traversal
  const filePath = path.resolve(CONTENT_DIR, '.' + urlPath);
  const boundary = CONTENT_DIR + path.sep;

  // Must be within CONTENT_DIR (exact match or child path)
  if (filePath !== CONTENT_DIR && !filePath.startsWith(boundary)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const lstat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!lstat) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // Reject symlinks that escape the content directory
  if (lstat.isSymbolicLink()) {
    const real = fs.realpathSync(filePath);
    if (real !== CONTENT_DIR && !real.startsWith(boundary)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

// ── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const pathname = url.pathname;

  // API routes
  if (pathname === '/api/actions') {
    if (req.method === 'GET') return handleGetActions(req, res);
    if (req.method === 'POST') return handlePostAction(req, res);
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  // DELETE or PATCH /api/actions/:id
  const actionIdMatch = pathname.match(/^\/api\/actions\/(.+)$/);
  if (actionIdMatch) {
    const actionId = decodeURIComponent(actionIdMatch[1]);
    if (req.method === 'DELETE') return handleDeleteAction(req, res, actionId);
    if (req.method === 'PATCH') return handlePatchAction(req, res, actionId);
  }

  // Static files (GET only)
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  const filePath = pathname === '/' ? '/daily-dashboard-v2.html' : pathname.split('?')[0];
  serveStatic(req, res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log(`Dashboard server on http://${HOST}:${PORT}`);
  console.log(`Content dir: ${CONTENT_DIR}`);
  console.log(`Queue file: ${QUEUE_PATH}`);
});
