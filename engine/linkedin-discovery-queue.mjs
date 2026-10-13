// Pending work and execution budgets only. Selection judgment belongs to skills.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { extractLinkedInJobId } from './job-identity.mjs';
import { isEnrichmentComplete } from './enrichment-completion.mjs';

export function validateDiscoveryJob(job) {
  const id = job.linkedinJobId;
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) throw new Error('Expected an exact numeric LinkedIn job ID string');
  let url;
  try { url = new URL(job.url); } catch { throw new Error('Invalid LinkedIn job URL'); }
  if (url.protocol !== 'https:' || !/(^|\.)linkedin\.com$/i.test(url.hostname) || url.username || url.password || url.port ||
      !/^\/jobs\/view\/(?:[^/]+-)?[1-9]\d*\/?$/.test(url.pathname) || extractLinkedInJobId(url.href) !== id ||
      !new RegExp(`(?:/|-)${id}/?$`).test(url.pathname)) throw new Error('LinkedIn job URL must match the exact job ID');
  const result = { linkedinJobId: id, url: `https://www.linkedin.com/jobs/view/${id}/` };
  // Retain source facts for skills/human inspection; no ranking or inferred fields.
  for (const key of ['title', 'company', 'location']) if (typeof job[key] === 'string') result[key] = job[key];
  if (typeof job.applyUrl === 'string' && job.sourceEvidence?.linkedinJobId === id) {
    let apply;
    try { apply = new URL(job.applyUrl); } catch { throw new Error('Invalid apply URL'); }
    if (!['https:', 'http:'].includes(apply.protocol) || apply.username || apply.password) throw new Error('Invalid apply URL');
    result.applyUrl = apply.href;
    result.sourceEvidence = structuredClone(job.sourceEvidence);
    if (typeof job.employerRequisitionId === 'string') result.employerRequisitionId = job.employerRequisitionId;
  }
  if (typeof job.postedAt === 'number' && Number.isFinite(job.postedAt)) result.postedAt = job.postedAt;
  return result;
}

function atomicWrite(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temp, path);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
function readOwner(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
function acquire(path) {
  const owner = { pid: process.pid, hostname: hostname(), token: randomUUID() };
  function create() {
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(owner)); } finally { closeSync(fd); }
  }
  try { create(); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Serialize dead-owner recovery. Malformed/foreign locks always require manual review.
    const recovery = `${path}.recovery`;
    let fd;
    try { fd = openSync(recovery, 'wx', 0o600); writeFileSync(fd, JSON.stringify(owner)); } catch (error) {
      if (fd !== undefined) { closeSync(fd); unlinkSync(recovery); }
      if (error.code !== 'EEXIST') throw error;
      throw Object.assign(new Error('Discovery queue recovery is locked; a dead recovery owner requires manual review'), { code: 'QUEUE_LOCKED' });
    }
    try {
      const old = readOwner(path);
      if (old?.hostname === hostname() && Number.isInteger(old.pid) && old.pid > 0 && !alive(old.pid)) unlinkSync(path);
      try { create(); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        throw Object.assign(new Error('Discovery queue is locked'), { code: 'QUEUE_LOCKED' });
      }
    } finally { closeSync(fd); unlinkSync(recovery); }
  }
  return () => { if (readOwner(path)?.token === owner.token) unlinkSync(path); };
}

export function openDiscoveryQueue({ work, timezone = 'UTC', now = () => new Date(), dailyCap = 10, runCap = 2 } = {}) {
  for (const value of [dailyCap, runCap]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Queue caps must be positive integers');
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const path = join(work, 'runtime', 'linkedin-discovery-queue.json');
  mkdirSync(dirname(path), { recursive: true });
  const release = acquire(`${path}.lock`);
  let state;
  try {
    state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 1, budget: { day: '', attempts: 0 }, entries: [] };
    if (state.version !== 1 || !Array.isArray(state.entries) || !state.budget || !Number.isSafeInteger(state.budget.attempts) || state.budget.attempts < 0) throw new Error('Invalid discovery queue state');
    const ids = new Set();
    for (const entry of state.entries) {
      validateDiscoveryJob(entry);
      if (ids.has(entry.linkedinJobId) || !['ingest', 'enrich'].includes(entry.stage) || !Number.isSafeInteger(entry.attempts) || entry.attempts < 0 || !Number.isFinite(Date.parse(entry.queuedAt))) throw new Error('Invalid discovery queue entry');
      ids.add(entry.linkedinJobId);
    }
  } catch (error) { release(); throw error; }
  let used = 0, closed = false;
  const attempted = new Set();
  function guard() { if (closed) throw new Error('Queue is closed'); }
  function save() { guard(); atomicWrite(path, state); }
  function day() { return dayFormat.format(now()); }
  function budget() {
    const today = day();
    // A clock/timezone rollback cannot grant another budget for an earlier day.
    if (!state.budget.day || today > state.budget.day) state.budget = { day: today, attempts: 0 };
    return state.budget;
  }
  function canonical(id) {
    const inbox = join(work, 'inbox');
    if (!existsSync(inbox)) return null;
    for (const dir of readdirSync(inbox, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const base = join(inbox, dir.name);
      if (!existsSync(join(base, 'metadata.json')) || !existsSync(join(base, 'job.md'))) continue;
      let meta;
      try {
        meta = JSON.parse(readFileSync(join(base, 'metadata.json'), 'utf8'));
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Expected metadata object');
      } catch {
        throw Object.assign(new Error(`Canonical inbox metadata requires repair: ${join(base, 'metadata.json')}; queue retained, no identity guessed`), { code: 'CANONICAL_METADATA_INVALID' });
      }
      if (String(meta.linkedinJobId || extractLinkedInJobId(meta.url)) === id || (Array.isArray(meta.linkedinAliases) && meta.linkedinAliases.includes(id))) return { id: dir.name, enriched: isEnrichmentComplete(base, meta) };
    }
    return null;
  }
  function dismissed(id) {
    return existsSync(join(work, 'runtime', 'linkedin-dismissals', `${id}.json`));
  }
  function entryFor(id) {
    guard();
    const entry = state.entries.find(e => e.linkedinJobId === id);
    if (!entry) throw new Error(`No pending queue entry: ${id}`);
    return entry;
  }
  function reconcile() {
    guard();
    state.entries = state.entries.filter(entry => {
      const found = canonical(entry.linkedinJobId);
      if (found?.enriched) return false;
      if (found) { entry.stage = 'enrich'; entry.canonicalId = found.id; }
      return true;
    });
    save();
  }
  return {
    path,
    enqueue(jobs) {
      guard();
      const validated = jobs.map(validateDiscoveryJob); // Reject whole input before mutation.
      const result = { added: [], duplicates: [] };
      for (const job of validated) {
        if (state.entries.some(e => e.linkedinJobId === job.linkedinJobId) || canonical(job.linkedinJobId) || dismissed(job.linkedinJobId)) result.duplicates.push(job.linkedinJobId);
        else {
          state.entries.push({ ...job, queuedAt: now().toISOString(), stage: 'ingest', attempts: 0, blocked: false, nextAttemptAt: null });
          result.added.push(job.linkedinJobId);
        }
      }
      save(); return result;
    },
    reconcile,
    beginNext() {
      guard();
      reconcile();
      const ledger = budget();
      if (used >= runCap || ledger.attempts >= dailyCap) { save(); return null; }
      const entry = state.entries.find(e => !attempted.has(e.linkedinJobId) && !e.blocked && e.attempts < 3 && (!e.nextAttemptAt || Date.parse(e.nextAttemptAt) <= now().getTime()));
      if (!entry) { save(); return null; }
      entry.attempts += 1;
      ledger.attempts += 1;
      used += 1;
      entry.lastAttemptAt = now().toISOString();
      // Persist a crash-safe cooldown before any external work starts.
      entry.nextAttemptAt = new Date(now().getTime() + Math.min(24 * 3600000, 3600000 * 2 ** (entry.attempts - 1))).toISOString();
      entry.blocked = entry.attempts >= 3;
      attempted.add(entry.linkedinJobId);
      save(); return structuredClone(entry);
    },
    ingested(id) {
      const entry = entryFor(id), found = canonical(id);
      if (!found) throw new Error('Cannot advance ingestion without canonical inbox evidence');
      entry.stage = 'enrich'; entry.canonicalId = found.id; save(); return found.id;
    },
    // Only call for process-job's explicit configured-company exclusion result.
    acknowledgeExcluded(id) {
      entryFor(id);
      state.entries = state.entries.filter(e => e.linkedinJobId !== id);
      save();
    },
    // Identity authority is process-job's explicit duplicate result, never title similarity.
    acknowledgeDuplicate(id, canonicalId) {
      entryFor(id);
      if (typeof canonicalId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(canonicalId)) throw new Error('Invalid canonical inbox ID');
      const base = join(work, 'inbox', canonicalId);
      if (!existsSync(join(base, 'metadata.json')) || !existsSync(join(base, 'job.md'))) throw new Error('Duplicate canonical inbox evidence is missing');
      const metadata = JSON.parse(readFileSync(join(base, 'metadata.json'), 'utf8'));
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid canonical metadata');
      metadata.linkedinAliases = [...new Set([...(Array.isArray(metadata.linkedinAliases) ? metadata.linkedinAliases : []), id])];
      atomicWrite(join(base, 'metadata.json'), metadata);
      state.entries = state.entries.filter(e => e.linkedinJobId !== id);
      save();
    },
    complete(id) {
      entryFor(id);
      if (!canonical(id)?.enriched) throw new Error('Cannot complete without canonical ingestion and enrichment evidence');
      state.entries = state.entries.filter(e => e.linkedinJobId !== id);
      save();
    },
    fail(id, { message = 'Attempt failed', blocked = false } = {}) {
      const entry = entryFor(id);
      entry.lastError = String(message).slice(0, 1000);
      entry.blocked = blocked || entry.attempts >= 3;
      save();
    },
    refundAttempt(id, { message = 'Attempt paused without consuming retry budget' } = {}) {
      const entry = entryFor(id);
      const ledger = budget();
      if (entry.attempts > 0) entry.attempts -= 1;
      if (ledger.attempts > 0) ledger.attempts -= 1;
      if (used > 0) used -= 1;
      entry.lastError = String(message).slice(0, 1000);
      entry.blocked = false;
      entry.nextAttemptAt = null;
      save();
    },
    retry(id) {
      const entry = entryFor(id);
      // Release the per-item retry ceiling, not the persisted daily ledger.
      entry.attempts = 0;
      entry.blocked = false;
      entry.nextAttemptAt = null;
      entry.lastError = 'Manually released for retry';
      save();
      return structuredClone(entry);
    },
    dismiss(id, { reason } = {}) {
      const entry = entryFor(id);
      if (typeof reason !== 'string' || !reason.trim()) throw new Error('Dismissal requires a nonempty reason');
      const evidencePath = join(work, 'runtime', 'linkedin-dismissals', `${id}.json`);
      mkdirSync(dirname(evidencePath), { recursive: true });
      // Evidence must be durable before removing pending work.
      atomicWrite(evidencePath, { ...structuredClone(entry), dismissedAt: now().toISOString(), reason: reason.trim().slice(0, 1000) });
      state.entries = state.entries.filter(e => e.linkedinJobId !== id);
      save();
      return { linkedinJobId: id, dismissed: true, reason: reason.trim().slice(0, 1000) };
    },
    summary() {
      guard();
      const ledger = budget();
      return { pending: state.entries.filter(e => !e.blocked).length, blocked: state.entries.filter(e => e.blocked).length,
        oldestQueuedAt: state.entries[0]?.queuedAt || null, attemptsToday: ledger.attempts, dailyCap, remainingToday: Math.max(0, dailyCap - ledger.attempts), attemptsThisRun: used, runUsed: used, dailyUsed: ledger.attempts, dailyRemaining: Math.max(0, dailyCap - ledger.attempts), runCap };
    },
    close() { if (!closed) { release(); closed = true; } },
  };
}
