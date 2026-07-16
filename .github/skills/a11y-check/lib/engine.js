import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';
import { checkSvgAccessibleName, checkSvgTextContrast } from './svg-a11y.js';

export async function runAxeScan(page, tags, axeTimeoutMs = 60_000) {
  const builder = new AxeBuilder({ page })
    .withTags(tags)
    .disableRules(['svg-img-alt']);

  const axePromise = builder.analyze();
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('axe-core analysis timed out')), axeTimeoutMs);
    timer.unref?.();
  });

  let axeResults;
  try {
    axeResults = await Promise.race([axePromise, timeoutPromise]);
  } catch (e) {
    console.error(`Warning: ${e.message}. Reporting partial results.`);
    throw Object.assign(new Error(`axe-core timed out after ${axeTimeoutMs / 1000}s`), { exitCode: 2 });
  } finally {
    clearTimeout(timer);
  }

  // Supplemental checks
  const svgNameFindings = await checkSvgAccessibleName(page);
  const contrastResult = await checkSvgTextContrast(page);

  const supplemental = [...svgNameFindings, ...contrastResult.findings];
  const informational = [...contrastResult.notes];

  return {
    violations: axeResults.violations,
    supplemental,
    informational,
    passCount: axeResults.passes ? axeResults.passes.length : 0,
  };
}

export async function createBrowser() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}
