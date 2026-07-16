import { sanitizeString } from './format.js';

export async function checkSvgAccessibleName(page) {
  const results = await page.evaluate(() => {
    const findings = [];
    const IMAGE_ROLES = ['img', 'graphics-document', 'graphics-symbol'];
    const DECORATIVE_ROLES = ['presentation', 'none'];
    const allSvgs = document.querySelectorAll('svg');

    for (const svg of allSvgs) {
      const parentSvg = svg.parentElement?.closest('svg');
      if (parentSvg && !svg.hasAttribute('role')) {
        continue;
      }

      const role = (svg.getAttribute('role') || '').toLowerCase().trim();
      if (DECORATIVE_ROLES.includes(role)) {
        continue;
      }

      const hasName = checkAccessibleName(svg);
      const emptyAriaLabel = svg.hasAttribute('aria-label') && svg.getAttribute('aria-label').trim() === '';

      if (IMAGE_ROLES.includes(role)) {
        if (emptyAriaLabel) {
          findings.push({
            role,
            selector: buildSelector(svg),
            message: `<svg> with role="${role}" has an empty aria-label, which does not provide an accessible name.`,
          });
          continue;
        }
        if (!hasName) {
          findings.push({
            role,
            selector: buildSelector(svg),
            message: `<svg> with role="${role}" has no accessible name. Add a <title>, aria-label, or aria-labelledby.`,
          });
        }
        continue;
      }

      if (!role || (!IMAGE_ROLES.includes(role) && !DECORATIVE_ROLES.includes(role))) {
        if (emptyAriaLabel) {
          findings.push({
            role: role || '(none)',
            selector: buildSelector(svg),
            message: '<svg> has an empty aria-label, which does not provide an accessible name.',
          });
          continue;
        }
        if (!hasName) {
          findings.push({
            role: '(none)',
            selector: buildSelector(svg),
            message: '<svg> with no role and no accessible name. Add role="img" with a <title>, aria-label, or aria-labelledby; or mark as decorative with role="none".',
          });
        }
      }
    }

    return findings;

    function checkAccessibleName(el) {
      const title = el.querySelector(':scope > title');
      if (title && title.textContent.trim()) return true;

      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) return true;

      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const ids = labelledBy.split(/\s+/).filter(Boolean);
        for (const id of ids) {
          const ref = document.getElementById(id);
          if (ref && ref.textContent.trim()) return true;
        }
      }

      return false;
    }

    function buildSelector(el) {
      const parts = [];
      let cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        let sel = cur.tagName.toLowerCase();
        if (cur.id) {
          sel += '#' + cur.id;
          parts.unshift(sel);
          break;
        }
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
          if (siblings.length > 1) {
            sel += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
          }
        }
        parts.unshift(sel);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }
  });

  if (!results || results.length === 0) return [];

  return results.map((f) => ({
    id: 'svg-accessible-name',
    impact: 'serious',
    description: 'Ensures SVG elements have accessible names for screen readers',
    help: sanitizeString(f.message),
    helpUrl: 'https://www.w3.org/WAI/tutorials/images/decorative/',
    tags: ['wcag2a', 'wcag2aa'],
    nodes: [
      {
        target: [sanitizeString(f.selector)],
        failureSummary: sanitizeString(f.message),
      },
    ],
  }));
}

/**
 * FR-009: Supplemental SVG text-contrast check.
 * Checks <text> and <tspan> elements within SVG subtrees for WCAG 2.1 contrast compliance.
 * Returns { findings: [...], notes: [...] }
 *   - findings: contrast violations (ratio < 4.5:1) → count toward exit code 1
 *   - notes: informational "contrast-unknown" skips → do NOT cause exit code 1
 *
 * Limitation: 4.5:1 applied universally; large-text 3:1 exception not yet implemented.
 * Background is resolved by hit-testing the painted shape behind the text
 * centroid (elementsFromPoint), NOT by reading ancestor fill — in the SVG paint
 * model `fill` is an inherited *foreground* paint (initial value black), so an
 * ancestor <g>/<svg> fill is never a visual background.
 */
export async function checkSvgTextContrast(page) {
  const raw = await page.evaluate(() => {
    const results = { findings: [], notes: [] };
    const svgs = document.querySelectorAll('svg');

    // Force every SVG element hit-testable so elementsFromPoint can see
    // background shapes that generators mark pointer-events:none (D3, vis.js,
    // etc. commonly do this to make decoration click-through). The scanned
    // page is discarded after the run, so this mutation is safe.
    for (const node of document.querySelectorAll('svg, svg *')) {
      if (node.style) node.style.setProperty('pointer-events', 'auto', 'important');
    }

    for (const svg of svgs) {
      const textEls = svg.querySelectorAll('text, tspan');
      for (const el of textEls) {
        analyzeTextElement(el, svg, results);
      }
    }
    return results;

    function tag(n) {
      return ((n && n.tagName) || '').toLowerCase();
    }

    function analyzeTextElement(el, svgRoot, out) {
      // Resolve foreground fill
      const fgResult = resolveForeground(el);
      if (fgResult.skip) {
        out.notes.push({
          selector: buildSelector(el),
          reason: fgResult.reason,
        });
        return;
      }

      // Resolve background fill
      const bgResult = resolveBackground(el, svgRoot);
      if (bgResult.skip) {
        out.notes.push({
          selector: buildSelector(el),
          reason: bgResult.reason,
        });
        return;
      }

      // Compute contrast ratio
      const ratio = contrastRatio(fgResult.rgb, bgResult.rgb);
      if (ratio < 4.5) {
        out.findings.push({
          selector: buildSelector(el),
          foreground: fgResult.raw,
          background: bgResult.raw,
          ratio: Math.round(ratio * 100) / 100,
          message: `SVG <text> has insufficient contrast ratio ${ratio.toFixed(2)}:1 (minimum 4.5:1). Foreground: ${fgResult.raw}, Background: ${bgResult.raw}`,
        });
      }
    }

    function resolveForeground(el) {
      const computed = getComputedStyle(el);
      const fillValue = computed.fill;
      const fillOpacity = parseFloat(computed.fillOpacity);
      const opacity = parseFloat(computed.opacity);

      // Check for skip conditions
      if (!fillValue || fillValue === 'none') {
        return { skip: true, reason: 'foreground fill is "none"' };
      }
      if (fillValue.startsWith('url(')) {
        return { skip: true, reason: 'foreground fill is a gradient/pattern (url reference)' };
      }
      if (fillOpacity < 1 || opacity < 1) {
        return { skip: true, reason: `partial opacity (fill-opacity: ${fillOpacity}, opacity: ${opacity})` };
      }

      const rgb = parseColor(fillValue);
      if (!rgb) {
        return { skip: true, reason: `cannot parse foreground fill: "${fillValue}"` };
      }
      if (rgb.a !== undefined && rgb.a < 1) {
        return { skip: true, reason: `foreground has alpha < 1 (${fillValue})` };
      }

      return { rgb, raw: fillValue };
    }

    // Only these SVG elements actually paint a filled region that can sit
    // behind text. <g>/<svg>/<defs>/<text>/<tspan> carry inherited `fill`
    // (a foreground paint), never a visual background, so they are skipped.
    function readPageBackground() {
      // Walk up from <body> to the first non-transparent background color.
      let node = document.body;
      while (node) {
        const rgb = parseColor(getComputedStyle(node).backgroundColor);
        if (rgb && !(rgb.a !== undefined && rgb.a === 0)) {
          return { rgb, raw: getComputedStyle(node).backgroundColor };
        }
        node = node.parentElement;
      }
      return { rgb: { r: 255, g: 255, b: 255 }, raw: '#ffffff (page fallback)' };
    }

    function resolveBackground(el, svgRoot) {
      // Only these SVG elements actually paint a filled region behind text.
      // <g>/<svg>/<defs>/<text>/<tspan> carry inherited `fill` (foreground paint).
      const BG_SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'path', 'polygon', 'polyline']);
      // Hit-test the painted shape behind the text centroid. `fill` on ancestor
      // <g>/<svg> is inherited FOREGROUND paint (initial value black), not a
      // background — reading it produced false "black background" 1:1 findings
      // on virtually every real diagram export (draw.io/Mermaid/D3 wrap <text>
      // in <g fill=...>).
      let box = el.getBoundingClientRect();
      if (!box.width || !box.height) {
        return { skip: true, reason: 'text has zero-area bounding box (not rendered)' };
      }
      // Ensure the centroid is inside the layout viewport so elementsFromPoint works.
      if (box.bottom < 0 || box.top > window.innerHeight || box.right < 0 || box.left > window.innerWidth) {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        box = el.getBoundingClientRect();
      }
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;

      // Walk the hit-test stack (topmost first). Only shapes painted BELOW the
      // text can be its background — this guards against decorative overlays
      // painted above the text being mistaken for a background. Hit-testing a
      // <tspan> centroid may return its parent <text>, so the whole text block
      // (the <text> and its <tspan>s) counts as "the text layer".
      const textRoot = tag(el) === 'tspan' ? (el.closest('text') || el) : el;
      let sawText = false;
      for (const node of document.elementsFromPoint(cx, cy)) {
        const t = tag(node);
        if (node === el || node === textRoot) { sawText = true; continue; }
        if (t === 'text' || t === 'tspan') {
          if (textRoot.contains(node) || node.contains(textRoot)) sawText = true;
          continue; // text-family element, never a background
        }

        // Reached the host page (left the SVG) → background is the page color.
        if (t === 'body' || t === 'html' || t === 'main') {
          break;
        }
        if (!BG_SHAPE_TAGS.has(t)) continue; // structural/foreground element → not a background
        if (!sawText) continue; // shape sits above the text → not its background

        const computed = getComputedStyle(node);
        const fill = computed.fill;
        if (!fill || fill === 'none') continue; // unfilled shape paints no background
        if (fill.startsWith('url(')) {
          return { skip: true, reason: 'background is a gradient/pattern (url reference)' };
        }
        const fillOpacity = parseFloat(computed.fillOpacity);
        const opacity = parseFloat(computed.opacity);
        if (fillOpacity < 1 || opacity < 1) {
          return { skip: true, reason: `background shape has partial opacity (fill-opacity: ${fillOpacity}, opacity: ${opacity})` };
        }
        const rgb = parseColor(fill);
        if (!rgb) {
          return { skip: true, reason: `cannot parse background fill: "${fill}"` };
        }
        if (rgb.a !== undefined && rgb.a < 1) {
          return { skip: true, reason: `background has alpha < 1 (${fill})` };
        }
        return { rgb, raw: fill };
      }

      // Nothing painted found at the centroid → fall back to the page background.
      return readPageBackground();
    }

    function parseColor(str) {
      if (!str) return null;
      const s = str.trim();

      // rgb(r, g, b) or rgb(r g b)
      const rgbMatch = s.match(/^rgb\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*\)$/i);
      if (rgbMatch) {
        return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] };
      }

      // rgba(r, g, b, a) or rgba(r g b / a)
      const rgbaMatch = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)[\s,/]+([0-9.]+)\s*\)$/i);
      if (rgbaMatch) {
        return { r: +rgbaMatch[1], g: +rgbaMatch[2], b: +rgbaMatch[3], a: +rgbaMatch[4] };
      }

      // Hex: #rgb, #rrggbb
      const hexMatch = s.match(/^#([0-9a-f]{3,8})$/i);
      if (hexMatch) {
        const hex = hexMatch[1];
        if (hex.length === 3) {
          return { r: parseInt(hex[0] + hex[0], 16), g: parseInt(hex[1] + hex[1], 16), b: parseInt(hex[2] + hex[2], 16) };
        }
        if (hex.length === 6) {
          return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
        }
        if (hex.length === 8) {
          const a = parseInt(hex.slice(6, 8), 16) / 255;
          if (a < 1) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a };
          return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
        }
      }

      return null;
    }

    // WCAG 2.1 relative luminance
    function relativeLuminance(rgb) {
      const rsrgb = rgb.r / 255;
      const gsrgb = rgb.g / 255;
      const bsrgb = rgb.b / 255;
      const r = rsrgb <= 0.03928 ? rsrgb / 12.92 : Math.pow((rsrgb + 0.055) / 1.055, 2.4);
      const g = gsrgb <= 0.03928 ? gsrgb / 12.92 : Math.pow((gsrgb + 0.055) / 1.055, 2.4);
      const b = bsrgb <= 0.03928 ? bsrgb / 12.92 : Math.pow((bsrgb + 0.055) / 1.055, 2.4);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    function contrastRatio(fg, bg) {
      const l1 = relativeLuminance(fg);
      const l2 = relativeLuminance(bg);
      const lighter = Math.max(l1, l2);
      const darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function buildSelector(el) {
      const parts = [];
      let cur = el;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        let sel = cur.tagName.toLowerCase();
        if (cur.id) {
          sel += '#' + cur.id;
          parts.unshift(sel);
          break;
        }
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
          if (siblings.length > 1) {
            sel += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
          }
        }
        parts.unshift(sel);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    }
  });

  if (!raw) return { findings: [], notes: [] };

  // Format findings as axe-like structures
  const findings = (raw.findings || []).map(f => ({
    id: 'svg-text-contrast',
    impact: 'serious',
    description: 'Ensures SVG text elements have sufficient color contrast (4.5:1 minimum)',
    help: sanitizeString(f.message),
    helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
    tags: ['wcag2aa'],
    nodes: [{
      target: [sanitizeString(f.selector)],
      failureSummary: sanitizeString(f.message),
    }],
  }));

  // Notes are informational — NOT violations
  const notes = (raw.notes || []).map(n => ({
    id: 'svg-text-contrast-unknown',
    impact: 'informational',
    description: 'SVG text contrast could not be determined — manual review recommended',
    help: sanitizeString(`contrast-unknown: ${n.reason}`),
    helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html',
    tags: ['wcag2aa'],
    nodes: [{
      target: [sanitizeString(n.selector)],
      failureSummary: sanitizeString(`contrast-unknown — manual review recommended: ${n.reason}`),
    }],
  }));

  return { findings, notes };
}
