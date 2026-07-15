/**
 * Apply temporal salience decay to unreinforced nodes.
 *
 * Formula: newSalience = max(0.1, salience − ratePerDay × daysSinceReinforced)
 *
 * Linear decay is idempotent across runs: applying decay twice (with the
 * last_reinforced reset that updateNode performs) yields the same cumulative
 * result as applying it once after the same total elapsed time.
 *
 * @param {import('./graph.js').KnowledgeGraph} graph
 * @param {object}  opts
 * @param {number}  [opts.ratePerDay=0.005] — salience units lost per day
 * @param {boolean} [opts.dryRun=false]     — preview without writing
 * @returns {{ decayed: number, unchanged: number, details: Array<{id: string, name: string, oldSalience: number, newSalience: number}> }}
 */
export function applyDecay(graph, opts = {}) {
  const { ratePerDay = 0.005, dryRun = false } = opts;

  const nodes = graph.findNodes({ pinned: false, limit: 1_000_000 });
  const now = Date.now();
  let decayed = 0;
  let unchanged = 0;
  const details = [];

  for (const node of nodes) {
    const reinforcedMs = new Date(node.last_reinforced).getTime();
    const daysSince = Math.max(0, (now - reinforcedMs) / 86_400_000);
    const raw = node.salience - ratePerDay * daysSince;
    const newSalience = Math.round(Math.max(0.1, raw) * 10000) / 10000;

    if (newSalience < node.salience) {
      details.push({
        id: node.id,
        name: node.name,
        oldSalience: node.salience,
        newSalience,
      });
      if (!dryRun) {
        graph.updateNode(node.id, { salience: newSalience });
      }
      decayed++;
    } else {
      unchanged++;
    }
  }

  return { decayed, unchanged, details };
}
