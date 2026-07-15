// Job store — one JSON file per job with atomic writes and Ed25519 signing.

import { readFileSync, writeFileSync, unlinkSync, readdirSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { getJobsDir, getDataDir } from "./paths.mjs";
import { ensureKeypair, signMessage, verifySignature } from "../../lib/ed25519-keys.mjs";

let _keys = null;
function getKeys(extDir) {
  if (!_keys) {
    _keys = ensureKeypair(join(getDataDir(extDir), "keys"));
  }
  return _keys;
}

/** Compute the signable payload — job JSON without the signature field. */
function getSignableContent(job) {
  const { _signature, ...rest } = job;
  return JSON.stringify(rest);
}

/**
 * Atomic write: write to temp file, then rename.
 * Rename is atomic on both NTFS and Linux.
 */
function atomicWrite(filePath, data) {
  const tmp = filePath + "." + randomBytes(6).toString("hex") + ".tmp";
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmp, filePath);
  } finally {
    try { unlinkSync(tmp); } catch { /* tmp already renamed or never written */ }
  }
}

/** Convert a name to a kebab-case ID */
export function nameToId(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Ensure the jobs directory exists */
function ensureJobsDir(extDir) {
  mkdirSync(getJobsDir(extDir), { recursive: true });
}

/** Read a single job by ID. Returns null if not found. */
export function readJob(extDir, jobId) {
  try {
    const raw = readFileSync(join(getJobsDir(extDir), `${jobId}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** List all jobs. Returns an array of job objects. */
export function listJobs(extDir) {
  ensureJobsDir(extDir);
  const dir = getJobsDir(extDir);
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    try {
      return JSON.parse(readFileSync(join(dir, f), "utf-8"));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/** Write a job (create or update). Signs the payload with Ed25519. */
export function writeJob(extDir, job) {
  ensureJobsDir(extDir);
  const { privateKey } = getKeys(extDir);
  const { _signature, ...unsigned } = job;
  const signable = JSON.stringify(unsigned);
  const signed = { ...unsigned, _signature: signMessage(signable, privateKey) };
  atomicWrite(join(getJobsDir(extDir), `${job.id}.json`), signed);
}

/**
 * Verify a job's Ed25519 signature.
 * @returns {{ valid: boolean, reason?: string }}
 */
export function verifyJob(extDir, job) {
  if (!job._signature) {
    return { valid: false, reason: "unsigned" };
  }
  const { publicKey } = getKeys(extDir);
  const signable = getSignableContent(job);
  if (verifySignature(signable, job._signature, publicKey)) {
    return { valid: true };
  }
  return { valid: false, reason: "signature mismatch" };
}

/** Delete a job by ID. Returns true if deleted, false if not found. */
export function deleteJob(extDir, jobId) {
  try {
    unlinkSync(join(getJobsDir(extDir), `${jobId}.json`));
    return true;
  } catch {
    return false;
  }
}

/** Check if a job ID already exists. */
export function jobExists(extDir, jobId) {
  return readJob(extDir, jobId) !== null;
}
