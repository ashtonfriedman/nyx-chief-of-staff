#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9999;
const HOST = '127.0.0.1';
const SCRIPT_DIR = __dirname;
const CONTENT_DIR = path.join(SCRIPT_DIR, 'data', 'content');
const PID_FILE = path.join(SCRIPT_DIR, '.dashboard.pid');

const MIME = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

function cleanup() {
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
}

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/daily-dashboard-v2.html';
  const resolved = path.resolve(path.join(CONTENT_DIR, url));
  if (resolved !== CONTENT_DIR && !resolved.startsWith(CONTENT_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' });
    return res.end('Forbidden');
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' });
      return res.end('Not Found');
    }
    const ext = path.extname(resolved).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

fs.writeFileSync(PID_FILE, String(process.pid));
server.listen(PORT, HOST, () => {
  process.stderr.write(`dashboard-server: listening on http://${HOST}:${PORT} (pid ${process.pid})\n`);
});

process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);
