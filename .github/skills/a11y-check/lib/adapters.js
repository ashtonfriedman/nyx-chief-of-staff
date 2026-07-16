import fs from 'node:fs';
import { renderDrawio, cleanupTmpDir } from './drawio.js';
import { blockAllRequests, allowSameOriginOnly } from './network.js';
import { buildPinnedUrl, resolveAndValidate, validateRedirect } from './ssrf.js';

const CSP_META = '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'; connect-src \'none\'">';

function readUtf8FileWithFd(resolvedPath) {
  const fd = fs.openSync(resolvedPath, 'r');
  try {
    return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
}

export async function loadHtml(page, resolvedPath, timeout) {
  await blockAllRequests(page);

  let html = readUtf8FileWithFd(resolvedPath);
  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, `$&\n${CSP_META}`);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, `$&\n<head>${CSP_META}</head>`);
  } else {
    html = `${CSP_META}\n${html}`;
  }

  await page.setContent(html, { waitUntil: 'domcontentloaded', timeout });

  const relativeRefs = await page.evaluate(() => {
    const refs = [];
    for (const el of document.querySelectorAll('link[href], script[src], img[src]')) {
      const attr = el.hasAttribute('href') ? 'href' : 'src';
      const val = el.getAttribute(attr);
      if (val && !val.startsWith('http') && !val.startsWith('data:') && !val.startsWith('#') && !val.startsWith('//')) {
        refs.push({ tag: el.tagName.toLowerCase(), attr, val });
      }
    }
    return refs;
  });

  if (relativeRefs.length > 0) {
    const tagList = [...new Set(relativeRefs.map((r) => `<${r.tag}>`))].join(', ');
    console.error(
      `Warning: ${relativeRefs.length} relative resource reference(s) detected (${tagList}); ` +
      'these cannot resolve under setContent (base is about:blank). ' +
      'Results may be inaccurate for non-self-contained HTML files.'
    );
  }
}

export async function loadSvg(page, resolvedPath, timeout) {
  await blockAllRequests(page);

  const svg = readUtf8FileWithFd(resolvedPath);
  const host = `<!doctype html><html lang="en"><head><meta charset="utf-8">${CSP_META}<title>svg</title></head><body style="background:#ffffff"><main>${svg}</main></body></html>`;

  await page.setContent(host, { waitUntil: 'domcontentloaded', timeout });
}

export async function loadDrawio(page, resolvedPath, timeout) {
  const { outputFile, tmpDir } = await renderDrawio(resolvedPath);
  try {
    await loadSvg(page, outputFile, timeout);
    return tmpDir;
  } catch (e) {
    cleanupTmpDir(tmpDir);
    throw e;
  }
}

export async function loadUrl(page, urlStr, timeout, allowRemote) {
  const { parsed, pinnedIp, isLocalhost } = await resolveAndValidate(urlStr, allowRemote);

  let navUrl;
  const allowedOrigins = [parsed.origin];
  if (isLocalhost) {
    navUrl = urlStr;
  } else {
    const { pinnedUrl, hostHeader } = buildPinnedUrl(parsed, pinnedIp);
    await page.setExtraHTTPHeaders({ Host: hostHeader });
    navUrl = pinnedUrl;
    allowedOrigins.push(new URL(pinnedUrl).origin);
  }

  const allowedOriginSet = new Set(allowedOrigins);
  const validateRequestUrl = async (candidateUrl, request) => {
    const candidate = new URL(candidateUrl);
    if (isLocalhost && allowedOriginSet.has(candidate.origin)) {
      return;
    }
    if (request.isNavigationRequest() || !allowedOriginSet.has(candidate.origin)) {
      await validateRedirect(candidate.href);
    }
  };
  const routeGuard = await allowSameOriginOnly(page, allowedOrigins, validateRequestUrl);

  try {
    const response = await page.goto(navUrl, { waitUntil: 'networkidle', timeout });
    const routeError = routeGuard.getError();
    if (routeError) throw routeError;
    if (response && response.status() >= 400) {
      throw Object.assign(new Error(`URL returned HTTP ${response.status()}: ${urlStr}`), { exitCode: 2 });
    }
  } catch (e) {
    const routeError = routeGuard.getError();
    if (routeError) throw routeError;
    if (e.exitCode) throw e;

    if (e.message && e.message.includes('Timeout')) {
      console.error(`Warning: Navigation timed out after ${timeout}ms. Scanning available DOM.`);
      const bodyText = await page.evaluate(() => document.body?.innerText?.trim() || '');
      if (!bodyText) {
        throw Object.assign(new Error(`Navigation timed out and page is blank: ${urlStr}`), { exitCode: 2 });
      }
    } else {
      throw Object.assign(new Error(`Failed to load URL: ${e.message}`), { exitCode: 2 });
    }
  }
}
