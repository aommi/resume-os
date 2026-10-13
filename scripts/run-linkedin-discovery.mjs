#!/usr/bin/env node
// Daily collection only. Persist candidates before advancing the collection watermark.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workDir, timezone } from '../engine/config.mjs';
import { readDiscoveryBoundary, finalizeDiscoveryBoundary } from '../engine/linkedin-discovery-boundary.mjs';
import { openDiscoveryQueue } from '../engine/linkedin-discovery-queue.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
export function collectJobs({ work = workDir(), repo = REPO, now = () => new Date(),
  zone = timezone(), search = () => JSON.parse(execFileSync(process.execPath,
    [join(repo, 'scripts/search-linkedin-jobs.mjs'), '--json'],
    { cwd: repo, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })) } = {}) {
  const started = now();
  const runDir = join(work, 'runtime', 'linkedin-discovery', String(started.getTime()));
  mkdirSync(runDir, { recursive: true });
  const hbPath = join(work, 'heartbeats', 'linkedin-discovery.json');
  mkdirSync(dirname(hbPath), { recursive: true });
  const stop = join(work, 'linkedin-stop.json');
  // Interactive reconciled sweeps still own the legacy repository boundary.
  const boundary = join(work, 'runtime', 'linkedin-collection-watermark');
  const report = { runStartedAt: started.toISOString(), windowHours: 24, found: 0, added: [], duplicates: [] };
  let queue, exitCode = 0, failureCategory = '', previous = {};
  try { previous = JSON.parse(readFileSync(hbPath, 'utf8')); } catch {}
  try {
    if (existsSync(stop)) throw Object.assign(new Error('LinkedIn is stopped; manual verification and explicit stop-file clearance required'), { code: 'LINKEDIN_STOPPED' });
    queue = openDiscoveryQueue({ work, timezone: zone, now });
    const expected = readDiscoveryBoundary(boundary);
    const jobs = search();
    if (!Array.isArray(jobs)) throw new Error('Search did not return an array');
    const recent = jobs.filter(job => Number.isFinite(job.postedAt) && job.postedAt >= started.getTime() - 86400000 && job.postedAt <= started.getTime() + 60000);
    writeFileSync(join(runDir, 'search.json'), JSON.stringify(jobs, null, 2), { mode: 0o600 });
    if (existsSync(stop)) throw Object.assign(new Error('LinkedIn stop was set during search'), { code: 'LINKEDIN_STOPPED' });
    report.found = recent.length;
    report.outsideWindowOrUndated = jobs.length - recent.length;
    Object.assign(report, queue.enqueue(recent));
    report.queue = queue.summary();
    finalizeDiscoveryBoundary({ path: boundary, expectedMs: expected, runStartedAtMs: started.getTime() });
  } catch (error) {
    if (/LINKEDIN_(?:AUTH_REQUIRED|RATE_LIMITED):/.test(`${error.message}\n${error.stderr || ''}`)) {
      if (!existsSync(stop)) writeFileSync(stop, JSON.stringify({ reason: /LINKEDIN_RATE_LIMITED:/.test(`${error.message} ${error.stderr || ''}`) ? 'rate_limited' : 'auth_challenge', detectedAt: now().toISOString(), workflow: 'linkedin-discovery' }) + '\n', { mode: 0o600 });
      error.code = 'LINKEDIN_STOPPED';
    }
    report.error = error.message;
    exitCode = 1;
    failureCategory = error.code === 'LINKEDIN_STOPPED' ? 'linkedin_stopped' : error.code === 'QUEUE_LOCKED' ? 'queue_busy' : 'discovery_failed';
  } finally {
    queue?.close();
    writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    writeFileSync(hbPath, JSON.stringify({ workflow: 'linkedin-discovery', cadenceMinutes: 1440,
      lastAttempt: started.toISOString(), lastSuccess: exitCode === 0 ? now().toISOString() : previous.lastSuccess || null,
      exitCode, failureCategory, runDir, model: 'none', queue: report.queue }) + '\n');
  }
  return { exitCode, report };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = collectJobs();
  const r = result.report, q = r.queue;
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 2) :
    r.error ? `Resume OS collection failed: ${r.error}` :
    `Resume OS discovery: ${r.found} recent matches, ${r.added.length} newly queued, ${r.duplicates.length} already known.\nWaiting: ${q.pending}; needs review: ${q.blocked}. Oldest waiting: ${q.oldestQueuedAt || 'none'}.\nProcessing budget: ${q.dailyCap} attempts/day; unfinished jobs stay queued.`);
  process.exitCode = result.exitCode;
}
