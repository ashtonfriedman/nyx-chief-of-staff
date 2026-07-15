#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { KnowledgeGraph } from './src/graph.js';
import { generateBootContext } from './src/boot-context.js';
import { applyDecay } from './src/decay.js';
import { sanitizeNodeDescription } from './src/utils.js';

// ── Arg Parsing (zero deps) ────────────────────────────────────

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
    i++;
  }
  return { positional, flags };
}

// ── Path Utilities ─────────────────────────────────────────────

/** Walk up from the script location to find the repo root. */
function findRepoRoot() {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (existsSync(join(dir, 'SOUL.md')) || existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function resolveDbPath(vault, flags) {
  if (flags.db) return resolve(flags.db);
  return join(vault, '.working-memory', 'graph.db');
}

/** Open graph, ensuring the directory exists for first-run. */
function openGraph(dbPath) {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return new KnowledgeGraph(dbPath);
}

// ── Commands ───────────────────────────────────────────────────

async function cmdIndex(flags) {
  const vault = flags.vault ? resolve(flags.vault) : findRepoRoot();
  const dbPath = resolveDbPath(vault, flags);
  const graph = openGraph(dbPath);
  try {
    let indexVault;
    try {
      ({ indexVault } = await import('./src/vault-parser.js'));
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.error('❌ vault-parser module not found — implement graph/src/vault-parser.js first');
        process.exitCode = 1;
        return;
      }
      throw err;
    }

    const result = indexVault(graph, vault, {
      force: !!flags.force,
      singleFile: flags.file || undefined,
      dryRun: !!flags['dry-run'],
    });

    console.log(`📂 Indexed vault: ${vault}`);
    console.log(`  📄 Files scanned:    ${result.filesScanned}`);
    console.log(`  ⏭️  Files skipped:    ${result.filesSkipped}`);
    console.log(`  📥 Files indexed:    ${result.filesIndexed}`);
    console.log(`  🔢 Nodes added:      ${result.nodesAdded}`);
    console.log(`  🔄 Nodes reinforced: ${result.nodesReinforced}`);
    console.log(`  🔗 Edges added:      ${result.edgesAdded}`);
    if (result.filesPruned || result.nodesPruned) {
      console.log(`  🗑️  Files pruned:     ${result.filesPruned}`);
      console.log(`  🗑️  Nodes pruned:     ${result.nodesPruned}`);
    }
    console.log(`  ⏱️  Duration:         ${result.durationMs}ms`);
    if (result.errors?.length) {
      console.log(`  ⚠️  Errors: ${result.errors.length}`);
      for (const e of result.errors) console.log(`     ${e}`);
    }

    // Regenerate the boot snapshot as a guaranteed byproduct of indexing so it
    // never drifts from the indexed DB. `index` and `context` used to be
    // separate steps — the nightly daemon re-indexed but left the boot file
    // stale. Coupling them removes that manual seam. Skipped on --dry-run;
    // opt out with --no-context.
    if (!flags['dry-run'] && !flags['no-context']) {
      const maxChars = flags['max-chars'] ? parseInt(flags['max-chars'], 10) : 4000;
      const bootPath = join(vault, '.working-memory', 'graph-boot-context.md');
      const output = generateBootContext(graph, { maxChars, vaultRoot: vault });
      mkdirSync(dirname(bootPath), { recursive: true });
      writeFileSync(bootPath, output, 'utf-8');
      console.log(`  📌 Boot context refreshed: ${bootPath} (${output.length} chars)`);
    }
  } finally {
    graph.close();
  }
}

function cmdQuery(term, flags) {
  if (!term) {
    console.error('Usage: graph-cli.js query <term> [--type TYPE] [--limit N]');
    process.exitCode = 1;
    return;
  }
  const vault = findRepoRoot();
  const dbPath = resolveDbPath(vault, flags);
  const graph = openGraph(dbPath);
  try {
    const limit = flags.limit ? parseInt(flags.limit, 10) : 10;
    let results = graph.searchNodes(term, limit);
    if (flags.type) {
      results = results.filter(r => r.node.type === flags.type);
    }
    for (const r of results) {
      console.log(JSON.stringify({
        node: {
          id: r.node.id,
          type: r.node.type,
          name: r.node.name,
          salience: r.node.salience,
          description: r.node.description,
        },
        score: r.score,
      }));
    }
    if (results.length === 0) {
      console.error('(no results)');
    }
  } finally {
    graph.close();
  }
}

function cmdContext(flags) {
  const vault = findRepoRoot();
  const dbPath = resolveDbPath(vault, flags);
  const graph = openGraph(dbPath);
  try {
    const maxChars = flags['max-chars'] ? parseInt(flags['max-chars'], 10) : 4000;
    const output = generateBootContext(graph, { maxChars, vaultRoot: vault });
    if (flags.output) {
      const outPath = resolve(flags.output);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, output, 'utf-8');
      console.log(`✅ Boot context written to ${flags.output} (${output.length} chars)`);
    } else {
      process.stdout.write(output + '\n');
    }
  } finally {
    graph.close();
  }
}

function cmdStats(flags) {
  const vault = findRepoRoot();
  const dbPath = resolveDbPath(vault, flags);
  const graph = openGraph(dbPath);
  try {
    const s = graph.stats();
    console.log('📊 Graph Statistics');
    console.log(`  🔢 Nodes:          ${s.nodeCount}`);
    console.log(`  🔗 Edges:          ${s.edgeCount}`);
    console.log(`  📈 Avg Salience:   ${s.avgSalience.toFixed(3)}`);
    console.log('  📦 Type Distribution:');
    for (const [type, count] of Object.entries(s.typeDistribution).sort((a, b) => b[1] - a[1])) {
      console.log(`     ${type}: ${count}`);
    }
  } finally {
    graph.close();
  }
}

function cmdGet(id, flags) {
  if (!id) {
    console.error('Usage: graph-cli.js get <id> [--subgraph] [--depth N]');
    process.exitCode = 1;
    return;
  }
  const vault = findRepoRoot();
  const dbPath = resolveDbPath(vault, flags);
  const graph = openGraph(dbPath);
  try {
    if (flags.subgraph != null) {
      const depth = flags.depth ? parseInt(flags.depth, 10) : 2;
      const nodes = graph.getSubgraph(id, depth);
      if (nodes.length === 0) {
        console.error(`❌ Node not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(nodes, null, 2));
    } else {
      const node = graph.getNode(id);
      if (!node) {
        console.error(`❌ Node not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(node, null, 2));
    }
  } finally {
    graph.close();
  }
}

function cmdPin(id, flags) {
  if (!id) { console.error('Usage: graph-cli.js pin <id>'); process.exitCode = 1; return; }
  const vault = findRepoRoot();
  const dbPath = resolveDbPath(vault, flags);
  const graph = openGraph(dbPath);
  try {
    if (graph.updateNode(id, { pinned: true })) {
      console.log(`📌 Pinned: ${id}`);
    } else {
      console.error(`❌ Node not found: ${id}`);
      process.exitCode = 1;
    }
  } finally {
    graph.close();
  }
}

function cmdUnpin(id, flags) {
  if (!id) { console.error('Usage: graph-cli.js unpin <id>'); process.exitCode = 1; return; }
  const vault = findRepoRoot();
  const dbPath = resolveDbPath(vault, flags);
  const graph = openGraph(dbPath);
  try {
    if (graph.updateNode(id, { pinned: false })) {
      console.log(`📌 Unpinned: ${id}`);
    } else {
      console.error(`❌ Node not found: ${id}`);
      process.exitCode = 1;
    }
  } finally {
    graph.close();
  }
}

function cmdDecay(flags) {
  const vault = findRepoRoot();
  const dbPath = resolveDbPath(vault, flags);
  const graph = openGraph(dbPath);
  try {
    const rate = flags.rate ? parseFloat(flags.rate) : 0.005;
    const dryRun = !!flags['dry-run'];
    const result = applyDecay(graph, { ratePerDay: rate, dryRun });
    const tag = dryRun ? ' (dry run)' : '';
    console.log(`⏳ Decay${tag}`);
    console.log(`  📉 Decayed:   ${result.decayed}`);
    console.log(`  ➡️  Unchanged: ${result.unchanged}`);
    if (result.details.length) {
      console.log('  Details:');
      for (const d of result.details) {
        console.log(`    ${d.name}: ${d.oldSalience.toFixed(3)} → ${d.newSalience.toFixed(3)}`);
      }
    }
  } finally {
    graph.close();
  }
}

// ── Usage ──────────────────────────────────────────────────────

function usage() {
  console.log(`Usage: node graph-cli.js <command> [options]

Commands:
  index              Index the vault
  query <term>       FTS5 search
  context            Generate boot context
  stats              Print graph statistics
  get <id>           Get node by ID
  pin <id>           Pin a node
  unpin <id>         Unpin a node
  decay              Apply salience decay
  manifest           Generate mind-index.md from filesystem

Global:
  --db PATH          Database path (default: <vault>/.working-memory/graph.db)
  --help             Show this help

index:
  --vault PATH       Vault root (default: auto-detect from script location)
  --force            Force re-index all files
  --file PATH        Index a single file
  --dry-run          Preview without writing

query:
  --type TYPE        Filter results by node type
  --limit N          Max results (default: 10)

context:
  --max-chars N      Output char limit (default: 3000)
  --output PATH      Write to file instead of stdout

get:
  --subgraph         Include neighbourhood subgraph
  --depth N          Subgraph traversal depth (default: 2)

decay:
  --rate FLOAT       Salience loss per day (default: 0.005)
  --dry-run          Preview without writing

manifest:
  --output PATH      Write to file instead of stdout`);
}

// ── Main ───────────────────────────────────────────────────────

const { positional, flags } = parseArgs(process.argv.slice(2));

if (flags.help) { usage(); process.exit(0); }

const [command, ...rest] = positional;

switch (command) {
  case 'index':   await cmdIndex(flags);          break;
  case 'query':   cmdQuery(rest[0], flags);       break;
  case 'context': cmdContext(flags);               break;
  case 'stats':   cmdStats(flags);                break;
  case 'get':     cmdGet(rest[0], flags);         break;
  case 'pin':     cmdPin(rest[0], flags);         break;
  case 'unpin':   cmdUnpin(rest[0], flags);       break;
  case 'decay':   cmdDecay(flags);                break;
  case 'manifest': {
    const vault = flags.vault ? resolve(flags.vault) : findRepoRoot();
    const { generateManifest } = await import('./src/manifest.js');
    const output = generateManifest(vault);
    if (flags.output) {
      writeFileSync(resolve(flags.output), output, 'utf-8');
      console.log(`✅ Manifest written to ${flags.output}`);
    } else {
      console.log(output);
    }
    break;
  }
  default:        usage();                        break;
}
