#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env.MOCK_DRAWIO_FAIL === '1') {
  process.stderr.write('Error: mock renderer simulated failure\n');
  process.exit(1);
}

if (process.env.MOCK_DRAWIO_HANG === '1') {
  await new Promise((r) => setTimeout(r, 120_000));
  process.exit(0);
}

const args = process.argv.slice(2);
let outputPath = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '-o' && args[i + 1]) {
    outputPath = args[i + 1];
    break;
  }
}

if (!outputPath) {
  process.stderr.write('mock-drawio: no -o argument found\n');
  process.exit(1);
}

const fixture = path.join(__dirname, 'fixtures', 'drawio-rendered.svg');
fs.copyFileSync(fixture, outputPath);
