const MAX_STRING_LEN = 200;

export function sanitizeString(str) {
  if (str == null) return '';
  let s = String(str);
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  if (s.length > MAX_STRING_LEN) {
    s = `${s.slice(0, MAX_STRING_LEN)}…`;
  }
  return s;
}

function sanitizeNodes(nodes, verbose) {
  return nodes.map((n) => {
    const sanitized = {
      target: Array.isArray(n.target) ? n.target.map(sanitizeString) : [],
      failureSummary: sanitizeString(n.failureSummary),
    };
    if (verbose && n.html) {
      sanitized.html = sanitizeString(n.html);
    }
    return sanitized;
  });
}

export function formatHuman(result) {
  const lines = [];
  lines.push(`a11y scan: ${result.target} [${result.kind}, tags=${result.tags.join(',')}]`);

  const totalFindings = result.violations.length + result.supplemental.length;
  if (totalFindings === 0 && (!result.informational || result.informational.length === 0)) {
    lines.push('PASS - 0 violations');
    return lines.join('\n');
  }

  if (totalFindings === 0) {
    lines.push('PASS - 0 violations');
  } else {
    lines.push(`FAIL - ${result.violations.length} violation type(s), ${result.supplemental.length} supplemental finding(s)\n`);
  }

  for (const v of result.violations) {
    lines.push(`  [${v.impact ?? 'n/a'}] ${v.id}: ${sanitizeString(v.help)}`);
    if (v.helpUrl) lines.push(`      ${v.helpUrl}`);
    const nodes = v.nodes || [];
    for (const node of nodes.slice(0, 5)) {
      const sel = Array.isArray(node.target) ? node.target.join(' ') : String(node.target);
      lines.push(`      - ${sanitizeString(sel)}`);
    }
    if (nodes.length > 5) lines.push(`      ...and ${nodes.length - 5} more`);
    lines.push('');
  }

  if (result.supplemental.length > 0) {
    lines.push('  Supplemental SVG findings:');
    for (const f of result.supplemental) {
      lines.push(`  [${f.impact ?? 'n/a'}] ${f.id}: ${sanitizeString(f.help)}`);
      if (f.helpUrl) lines.push(`      ${f.helpUrl}`);
      const nodes = f.nodes || [];
      for (const node of nodes.slice(0, 5)) {
        const sel = Array.isArray(node.target) ? node.target.join(' ') : String(node.target);
        lines.push(`      - ${sanitizeString(sel)}`);
      }
      lines.push('');
    }
  }

  if (result.informational && result.informational.length > 0) {
    lines.push('  Informational (manual review recommended):');
    for (const n of result.informational) {
      lines.push(`  [info] ${n.id}: ${sanitizeString(n.help)}`);
      const nodes = n.nodes || [];
      for (const node of nodes.slice(0, 3)) {
        const sel = Array.isArray(node.target) ? node.target.join(' ') : String(node.target);
        lines.push(`      - ${sanitizeString(sel)}`);
      }
      if (nodes.length > 3) lines.push(`      ...and ${nodes.length - 3} more`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatJson(result, verbose) {
  const output = {
    target: result.target,
    kind: result.kind,
    tags: result.tags,
    violations: result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      description: sanitizeString(v.description),
      help: sanitizeString(v.help),
      helpUrl: v.helpUrl,
      tags: v.tags,
      nodes: sanitizeNodes(v.nodes || [], verbose),
    })),
    supplemental: result.supplemental.map((f) => ({
      id: f.id,
      impact: f.impact,
      description: sanitizeString(f.description),
      help: sanitizeString(f.help),
      helpUrl: f.helpUrl,
      tags: f.tags,
      nodes: sanitizeNodes(f.nodes || [], verbose),
    })),
    informational: (result.informational || []).map((n) => ({
      id: n.id,
      impact: n.impact,
      description: sanitizeString(n.description),
      help: sanitizeString(n.help),
      helpUrl: n.helpUrl,
      tags: n.tags,
      nodes: sanitizeNodes(n.nodes || [], verbose),
    })),
    passes: result.passCount,
  };
  return JSON.stringify(output, null, 2);
}
