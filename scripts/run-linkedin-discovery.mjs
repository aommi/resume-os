#!/usr/bin/env node
// Daily collection only. Read a fixed recent LinkedIn window from page 0, persist candidates.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workDir, timezone } from '../engine/config.mjs';
import { assertLinkedInCooldown, recordLinkedInCooldown } from '../engine/linkedin-cooldown.mjs';
import { openDiscoveryQueue } from '../engine/linkedin-discovery-queue.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SEARCH_WINDOW_MS = 48 * 3600000;
export function collectJobs({ work = workDir(), repo = REPO, now = () => new Date(),
  zone = timezone(), searchWindowMs = DEFAULT_SEARCH_WINDOW_MS, overlapMs,
  search = ({ since }) => JSON.parse(execFileSync(process.execPath,
    [join(repo, 'scripts/search-linkedin-jobs.mjs'), '--coverage-json', '--since', since],
    { cwd: repo, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })) } = {}) {
  const started = now();
  const windowMs = overlapMs ?? searchWindowMs;
  const runDir = join(work, 'runtime', 'linkedin-discovery', String(started.getTime()));
  mkdirSync(runDir, { recursive: true });
  const hbPath = join(work, 'heartbeats', 'linkedin-discovery.json');
  mkdirSync(dirname(hbPath), { recursive: true });
  const stop = join(work, 'linkedin-stop.json');
  const report = { runStartedAt: started.toISOString(), found: 0, added: [], duplicates: [] };
  let queue, exitCode = 0, failureCategory = '', previous = {};
  try { previous = JSON.parse(readFileSync(hbPath, 'utf8')); } catch {}
  try {
    if (existsSync(stop)) throw Object.assign(new Error('LinkedIn is stopped; manual verification and explicit stop-file clearance required'), { code: 'LINKEDIN_STOPPED' });
    assertLinkedInCooldown({ work, now: now() });
    queue = openDiscoveryQueue({ work, timezone: zone, now });
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) throw new Error('Search window must be positive milliseconds');
    report.since = new Date(started.getTime() - windowMs).toISOString();
    const result = search({ since: report.since });
    assertLinkedInCooldown({ work, now: now() });
    const jobs = Array.isArray(result) ? result : result?.jobs;
    if (!Array.isArray(jobs)) throw new Error('Search did not return jobs');
    const coverage = Array.isArray(result) ? { complete: false, queries: [], reason: 'legacy_coverage_unknown' } : result.coverage;
    if (!coverage || typeof coverage.complete !== 'boolean' || !Array.isArray(coverage.queries)) throw new Error('Invalid search coverage');
    const recent = jobs.filter(job => !Number.isFinite(job.postedAt) || (job.postedAt >= Date.parse(report.since) && job.postedAt <= started.getTime() + 60000));
    writeFileSync(join(runDir, 'search.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    if (existsSync(stop)) throw Object.assign(new Error('LinkedIn stop was set during search'), { code: 'LINKEDIN_STOPPED' });
    report.found = recent.length;
    report.undated = recent.filter(job => !Number.isFinite(job.postedAt)).length;
    report.outsideWindow = jobs.length - recent.length;
    report.coverage = coverage;
    report.hitPageCap = coverage.queries.some(q => q.reason === 'page_cap');
    Object.assign(report, queue.enqueue(recent));
    report.queue = queue.summary();
    if (coverage.queries.some(q => q.reason === 'page_error')) {
      const error = new Error('Collection page failed; queued results preserved');
      error.code = 'COVERAGE_INCOMPLETE';
      throw error;
    }
  } catch (error) {
    if (error.code === 'LINKEDIN_COOLDOWN' || /LINKEDIN_RATE_LIMITED:/.test(`${error.message} ${error.stderr || ''}`)) {
      error.code = 'LINKEDIN_COOLDOWN';
      try { assertLinkedInCooldown({ work, now: now() }); error.retryAt = recordLinkedInCooldown({ work, now: now(), workflow: 'linkedin-discovery' }).retryAt; } catch (cooldown) {
        if (cooldown.code !== 'LINKEDIN_COOLDOWN') { error.message = cooldown.message; error.code = cooldown.code || 'COOLDOWN_STATE_INVALID'; }
        if (cooldown.retryAt) error.retryAt = cooldown.retryAt;
      }
    } else if (/LINKEDIN_AUTH_REQUIRED:/.test(`${error.message}\n${error.stderr || ''}`)) {
      if (!existsSync(stop)) writeFileSync(stop, JSON.stringify({ reason: 'auth_challenge', detectedAt: now().toISOString(), workflow: 'linkedin-discovery' }) + '\n', { mode: 0o600 });
      error.code = 'LINKEDIN_STOPPED';
    }
    report.error = error.message;
    if (error.retryAt) report.retryAt = error.retryAt;
    exitCode = 1;
    failureCategory = error.code === 'LINKEDIN_COOLDOWN' ? 'linkedin_cooldown' : error.code === 'LINKEDIN_STOPPED' ? 'linkedin_stopped' : error.code === 'QUEUE_LOCKED' ? 'queue_busy' : error.code === 'COVERAGE_INCOMPLETE' ? 'coverage_incomplete' : 'discovery_failed';
  } finally {
    queue?.close();
    writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    writeFileSync(hbPath, JSON.stringify({ workflow: 'linkedin-discovery', cadenceMinutes: 1440,
      lastAttempt: started.toISOString(), lastSuccess: exitCode === 0 ? now().toISOString() : previous.lastSuccess || null,
      exitCode, failureCategory, runDir, model: 'none', queue: report.queue, coverage: report.coverage, hitPageCap: report.hitPageCap }) + '\n');
  }
  return { exitCode, report };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = collectJobs();
  const r = result.report, q = r.queue;
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 2) :
    r.error ? `Resume OS collection failed: ${r.error}` :
    `Resume OS discovery: ${r.found} recent matches, ${r.added.length} newly queued, ${r.duplicates.length} already known.\nWaiting: ${q.pending}; needs review: ${q.blocked}. Oldest waiting: ${q.oldestQueuedAt || 'none'}.\nCollection: fixed recent window${r.hitPageCap ? '; page cap hit' : ''}.\nProcessing budget: ${q.dailyCap} attempts/day; unfinished jobs stay queued.`);
  process.exitCode = result.exitCode;
}
