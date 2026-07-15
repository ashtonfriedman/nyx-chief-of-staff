// Extension: graph-query
// Direct tool access to the agent knowledge graph — same friction as grep/glob.

import { joinSession } from "@github/copilot-sdk/extension";
import { execFile } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = resolve(repoRoot, "graph", "graph-cli.js");

function run(args) {
    return new Promise((res) => {
        execFile("node", [cli, ...args], { cwd: repoRoot }, (err, stdout, stderr) => {
            if (err) res(`Error: ${stderr || err.message}`);
            else res(stdout.trim());
        });
    });
}

await joinSession({
    tools: [
        {
            name: "graph_search",
            description:
                "Search the agent knowledge graph (BM25 full-text). Returns JSON lines with node id, type, name, description, salience, and relevance score. Use BEFORE grep/glob when looking for vault knowledge — expertise, initiatives, people, domains, decisions, patterns.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search term (FTS5 — use exact terms or wildcards like term*)" },
                    type: {
                        type: "string",
                        description: "Filter by node type",
                        enum: ["domain", "initiative", "expertise", "person", "decision", "concept", "pattern", "rule", "next_action"],
                    },
                    limit: { type: "number", description: "Max results (default 10)" },
                },
                required: ["query"],
            },
            skipPermission: true,
            handler: async (args) => {
                const cmdArgs = ["query", args.query];
                if (args.type) cmdArgs.push("--type", args.type);
                cmdArgs.push("--limit", String(args.limit || 10));
                return await run(cmdArgs);
            },
        },
        {
            name: "graph_node",
            description:
                "Get a specific knowledge graph node with its neighborhood (connected nodes). Use when you have a node ID from graph_search and need to see what it links to.",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "string", description: "Node ID (e.g. expertise-code-review, person-jane-doe)" },
                    depth: { type: "number", description: "Subgraph traversal depth (default 2)" },
                },
                required: ["id"],
            },
            skipPermission: true,
            handler: async (args) => {
                const cmdArgs = ["get", args.id, "--subgraph", "--depth", String(args.depth || 2)];
                return await run(cmdArgs);
            },
        },
    ],
});
