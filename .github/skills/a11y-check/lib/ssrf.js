import dns from 'node:dns';
import { URL } from 'node:url';

const BLOCKED_RANGES = [
  { prefix: '0.', type: 'unspecified' },
  { prefix: '127.', type: 'loopback' },
  { prefix: '10.', type: 'rfc1918' },
  { prefix: '169.254.', type: 'link-local' },
  {
    check: (ip) => {
      const m = ip.match(/^172\.(\d+)\./);
      return m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
    },
    type: 'rfc1918',
  },
  { prefix: '192.168.', type: 'rfc1918' },
];

export function isBlockedIp(ip) {
  if (!ip) return { blocked: true, reason: 'empty IP' };

  const normalized = normalizeIp(ip);
  if (normalized === '::1') return { blocked: true, reason: 'IPv6 loopback' };
  if (normalized.startsWith('fe80:')) return { blocked: true, reason: 'IPv6 link-local' };
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.slice(7);
    const v4Result = checkIpv4(v4);
    if (v4Result.blocked) return v4Result;
  }

  const v4Result = checkIpv4(normalized);
  if (v4Result.blocked) return v4Result;

  return { blocked: false };
}

function normalizeIp(ip) {
  return ip.toLowerCase().trim();
}

function checkIpv4(ip) {
  for (const range of BLOCKED_RANGES) {
    if (range.prefix && ip.startsWith(range.prefix)) {
      return { blocked: true, reason: range.type };
    }
    if (range.check && range.check(ip)) {
      return { blocked: true, reason: range.type };
    }
  }
  if (ip === '169.254.169.254') {
    return { blocked: true, reason: 'cloud-metadata' };
  }
  return { blocked: false };
}

export function isLocalhostHostname(hostname) {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

export async function resolveAndValidate(urlStr, allowRemote) {
  const parsed = new URL(urlStr);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');

  if (!isLocalhostHostname(hostname) && !allowRemote) {
    throw Object.assign(
      new Error(`Remote URL targets require --allow-remote. Target hostname: ${hostname}`),
      { exitCode: 2 }
    );
  }

  if (isLocalhostHostname(hostname)) {
    return { parsed, pinnedIp: '127.0.0.1', isLocalhost: true };
  }

  const ip = await resolveHostname(hostname);
  const check = isBlockedIp(ip);
  if (check.blocked) {
    throw Object.assign(
      new Error(`URL target blocked: hostname "${hostname}" resolves to ${ip} (${check.reason}). SSRF policy (SR-002).`),
      { exitCode: 2 }
    );
  }

  return { parsed, pinnedIp: ip, isLocalhost: false };
}

export function buildPinnedUrl(parsed, pinnedIp) {
  const pinnedUrl = new URL(parsed.href);
  pinnedUrl.hostname = pinnedIp;
  return {
    pinnedUrl: pinnedUrl.href,
    hostHeader: parsed.hostname + (parsed.port ? `:${parsed.port}` : ''),
  };
}

export async function validateRedirect(redirectUrl) {
  let parsed;
  try {
    parsed = new URL(redirectUrl);
  } catch (e) {
    throw Object.assign(new Error(`Invalid redirect URL "${redirectUrl}": ${e.message}`), { exitCode: 2 });
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const ip = await resolveHostname(hostname);

  const check = isBlockedIp(ip);
  if (check.blocked) {
    throw Object.assign(
      new Error(`Redirect to blocked address: ${redirectUrl} resolves to ${ip} (${check.reason}). SSRF policy (SR-002).`),
      { exitCode: 2 }
    );
  }
}

async function resolveHostname(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
    return hostname;
  }

  if (hostname === 'localhost') {
    return '127.0.0.1';
  }

  let addresses;
  try {
    addresses = await dns.promises.resolve4(hostname);
  } catch {
    try {
      addresses = await dns.promises.resolve6(hostname);
    } catch (e) {
      throw Object.assign(
        new Error(`Cannot resolve hostname "${hostname}": ${e.message}`),
        { exitCode: 2 }
      );
    }
  }

  if (!addresses || addresses.length === 0) {
    throw Object.assign(new Error(`No addresses found for hostname "${hostname}"`), { exitCode: 2 });
  }

  return addresses[0];
}
