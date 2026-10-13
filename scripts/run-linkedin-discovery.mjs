#!/usr/bin/env node
// Daily collection only. Persist candidates before advancing the collection watermark.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workDir, timezone } from '../engine/config.mjs';
import { readDiscoveryBoundary, finalizeDiscoveryBoundary } from '../engine/linkedin-discovery-boundary.mjs';
import { openDiscoveryQueue } from '../engine/linkedin-discovery-queue.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
export function collectJobs({ work = workDir(), repo = REPO, now = () => new Date(),
  zone = timezone(), overlapMs = 86400000, search = ({ since, cursor }) => JSON.parse(execFileSync(process.execPath,
    [join(repo, 'scripts/search-linkedin-jobs.mjs'), '--coverage-json', '--since', since, '--cursor-json', JSON.stringify(cursor)],
    { cwd: repo, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })) } = {}) {
  const started = now();
  const runDir = join(work, 'runtime', 'linkedin-discovery', String(started.getTime()));
  mkdirSync(runDir, { recursive: true });
  const hbPath = join(work, 'heartbeats', 'linkedin-discovery.json');
  mkdirSync(dirname(hbPath), { recursive: true });
  const stop = join(work, 'linkedin-stop.json');
  // Interactive reconciled sweeps still own the legacy repository boundary.
  const boundary = join(work, 'runtime', 'linkedin-collection-watermark');
  const cursorPath = join(work, 'runtime', 'linkedin-collection-cursor.json');
  const report = { runStartedAt: started.toISOString(), found: 0, added: [], duplicates: [], checkpointAdvanced: false };
  let queue, exitCode = 0, failureCategory = '', previous = {};
  try { previous = JSON.parse(readFileSync(hbPath, 'utf8')); } catch {}
  try {
    if (existsSync(stop)) throw Object.assign(new Error('LinkedIn is stopped; manual verification and explicit stop-file clearance required'), { code: 'LINKEDIN_STOPPED' });
    queue = openDiscoveryQueue({ work, timezone: zone, now });
    const expected = readDiscoveryBoundary(boundary);
    if (!Number.isSafeInteger(overlapMs) || overlapMs < 1) throw new Error('Overlap must be positive milliseconds');
    let cycle = existsSync(cursorPath) ? JSON.parse(readFileSync(cursorPath, 'utf8')) : null;
    if (cycle && (!Number.isSafeInteger(cycle.startedAtMs) || !Number.isSafeInteger(cycle.sinceMs) || !Array.isArray(cycle.cursor))) throw new Error('Invalid collection cursor');
    // Recover an interrupted cleanup after the checkpoint was committed.
    if (cycle && expected !== null && cycle.startedAtMs <= expected) cycle = null;
    cycle ??= { startedAtMs: started.getTime(), sinceMs: (expected ?? started.getTime()) - overlapMs, cursor: [] };
    report.since = new Date(cycle.sinceMs).toISOString();
    report.catchupStartedAt = new Date(cycle.startedAtMs).toISOString();
    const result = search({ since: report.since, cursor: cycle.cursor });
    const jobs = Array.isArray(result) ? result : result?.jobs;
    if (!Array.isArray(jobs)) throw new Error('Search did not return jobs');
    // Legacy array producers remain usable but cannot certify full traversal.
    const coverage = Array.isArray(result) ? { complete: false, queries: [], reason: 'legacy_coverage_unknown' } : result.coverage;
    if (!coverage || typeof coverage.complete !== 'boolean' || !Array.isArray(coverage.queries)) throw new Error('Invalid search coverage');
    const recent = jobs.filter(job => !Number.isFinite(job.postedAt) || (job.postedAt >= cycle.sinceMs && job.postedAt <= started.getTime() + 60000));
    writeFileSync(join(runDir, 'search.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    if (existsSync(stop)) throw Object.assign(new Error('LinkedIn stop was set during search'), { code: 'LINKEDIN_STOPPED' });
    report.found = recent.length;
    report.undated = recent.filter(job => !Number.isFinite(job.postedAt)).length;
    report.outsideWindow = jobs.length - recent.length;
    report.coverage = coverage;
    Object.assign(report, queue.enqueue(recent));
    report.queue = queue.summary();
    if (coverage.complete && coverage.queries.length && coverage.queries.every(q => q.complete === true)) {
      finalizeDiscoveryBoundary({ path: boundary, expectedMs: expected, runStartedAtMs: cycle.startedAtMs });
      report.checkpointAdvanced = true;
      if (existsSync(cursorPath)) unlinkSync(cursorPath);
    } else {
      const temp = `${cursorPath}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify({ ...cycle, cursor: coverage.queries }, null, 2) + '\n', { mode: 0o600 });
      renameSync(temp, cursorPath);
      if (coverage.queries.some(q => ['page_error', 'repeated_page'].includes(q.reason))) {
        const error = new Error('Collection traversal stalled; queued results preserved, checkpoint unchanged');
        error.code = 'COVERAGE_INCOMPLETE';
        throw error;
      }
    }
  } catch (error) {
    if (/LINKEDIN_(?:AUTH_REQUIRED|RATE_LIMITED):/.test(`${error.message}\n${error.stderr || ''}`)) {
      if (!existsSync(stop)) writeFileSync(stop, JSON.stringify({ reason: /LINKEDIN_RATE_LIMITED:/.test(`${error.message} ${error.stderr || ''}`) ? 'rate_limited' : 'auth_challenge', detectedAt: now().toISOString(), workflow: 'linkedin-discovery' }) + '\n', { mode: 0o600 });
      error.code = 'LINKEDIN_STOPPED';
    }
    report.error = error.message;
    exitCode = 1;
    failureCategory = error.code === 'LINKEDIN_STOPPED' ? 'linkedin_stopped' : error.code === 'QUEUE_LOCKED' ? 'queue_busy' : error.code === 'COVERAGE_INCOMPLETE' ? 'coverage_incomplete' : 'discovery_failed';
  } finally {
    queue?.close();
    writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    writeFileSync(hbPath, JSON.stringify({ workflow: 'linkedin-discovery', cadenceMinutes: 1440,
      lastAttempt: started.toISOString(), lastSuccess: exitCode === 0 ? now().toISOString() : previous.lastSuccess || null,
      exitCode, failureCategory, runDir, model: 'none', queue: report.queue, coverage: report.coverage }) + '\n');
  }
  return { exitCode, report };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = collectJobs();
  const r = result.report, q = r.queue;
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 2) :
    r.error ? `Resume OS collection failed: ${r.error}` :
    `Resume OS discovery: ${r.found} recent matches, ${r.added.length} newly queued, ${r.duplicates.length} already known.\nWaiting: ${q.pending}; needs review: ${q.blocked}. Oldest waiting: ${q.oldestQueuedAt || 'none'}.\nCoverage: ${r.checkpointAdvanced ? 'complete; checkpoint advanced' : 'partial; catch-up retained'}.\nProcessing budget: ${q.dailyCap} attempts/day; unfinished jobs stay queued.`);
  process.exitCode = result.exitCode;
}
