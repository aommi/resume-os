#!/usr/bin/env node
// Scheduled forward-only discovery. Judgment remains in the enrichment skill.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workDir } from '../engine/config.mjs';
import { readDiscoveryBoundary, finalizeDiscoveryBoundary } from '../engine/linkedin-discovery-boundary.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = workDir();
const enrichModel = JSON.parse(readFileSync(join(repo, 'engine/models.json'), 'utf8')).steps.discovery_enrich.model;
const started = Date.now();
const runDir = join(work, 'runtime', 'linkedin-discovery', String(started));
mkdirSync(runDir, { recursive: true });
const hbPath = join(work, 'heartbeats', 'linkedin-discovery.json');
mkdirSync(dirname(hbPath), { recursive: true });
let previous = {};
try { previous = JSON.parse(readFileSync(hbPath, 'utf8')); } catch {}
const report = { runStartedAt: new Date(started).toISOString(), windowHours: 24, found: 0, ingested: [], duplicates: [], enrichmentFailures: [], failures: [] };
const boundaryPath = join(repo, '.linkedin-last-checked');
const expected = readDiscoveryBoundary(boundaryPath);

function node(script, args = [], timeout = 240000) {
  return execFileSync(process.execPath, [join(repo, 'scripts', script), ...args], {
    cwd: repo, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

try {
  // Never expand this scheduled window to compensate for a stale heartbeat.
  const jobs = JSON.parse(node('search-linkedin-jobs.mjs', ['--json']));
  const recent = jobs.filter(job => Number.isFinite(job.postedAt) && job.postedAt >= started - 86400000);
  report.found = recent.length;
  report.outsideWindowOrUndated = jobs.length - recent.length;
  writeFileSync(join(runDir, 'search.json'), JSON.stringify(jobs, null, 2));
  for (const job of recent) {
    try {
      const result = JSON.parse(node('process-job.mjs', [job.url, '--out', join(work, 'inbox', job.linkedinJobId), '--no-save']));
      writeFileSync(join(runDir, `${job.linkedinJobId}.json`), JSON.stringify(result, null, 2));
      if (result.duplicate || result.status === 'duplicate' || result.skipped === 'duplicate') {
        report.duplicates.push(job.linkedinJobId);
      } else if (existsSync(join(work, 'inbox', job.linkedinJobId, 'metadata.json')) && existsSync(join(work, 'inbox', job.linkedinJobId, 'job.md'))) {
        report.ingested.push(job.linkedinJobId);
      } else {
        throw new Error('ingestion returned without a saved job or an exact duplicate result');
      }
    } catch (error) { report.failures.push({ id: job.linkedinJobId, error: error.message }); }
  }
  if (report.ingested.length) {
    const prompt = `Enrich ONLY these newly ingested job IDs: ${report.ingested.join(', ')}. Work directory: ${work}. Load skill resume-os-enrich and follow its ATS routing workflow using scripts/enrich-job.mjs. Save factual JD enrichment.md and enrichedAt/atsType metadata under that job's profile work inbox. No new searches, historical catch-up, fit assessment, resume work, messages, or LinkedIn save actions. Continue after an individual enrichment failure and report failures. Do not update the discovery timestamp; the wrapper owns it.`;
    try {
      const output = execFileSync('hermes', ['chat', '-q', prompt, '--model', enrichModel, '-Q', '-t', 'terminal,file,browser', '--max-turns', '40', '--ignore-rules'], {
        cwd: repo, encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      writeFileSync(join(runDir, 'enrichment.log'), output);
    } catch (error) { writeFileSync(join(runDir, 'enrichment.log'), `${error.message}\n${error.stdout || ''}`); }
    report.enrichmentFailures = report.ingested.filter(id => !existsSync(join(work, 'inbox', id, 'enrichment.md')));
  }
  node('job-board.mjs', ['render']);
  if (report.failures.length) throw new Error(`${report.failures.length} job ingestion(s) failed; see ${runDir}`);
  finalizeDiscoveryBoundary({ path: boundaryPath, expectedMs: expected, runStartedAtMs: started });
  writeHeartbeat(0, '');
} catch (error) {
  report.error = `${error.message}${error.stderr ? `\n${error.stderr}` : ''}`;
  writeHeartbeat(1, 'discovery_failed');
  process.exitCode = 1;
} finally {
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

function writeHeartbeat(exitCode, failureCategory) {
  writeFileSync(hbPath, JSON.stringify({ workflow: 'linkedin-discovery', cadenceMinutes: 480,
    lastAttempt: report.runStartedAt, lastSuccess: exitCode === 0 ? new Date().toISOString() : previous.lastSuccess || null,
    exitCode, failureCategory, runDir, model: report.ingested.length ? enrichModel : 'none',
    enrichmentFailures: report.enrichmentFailures,
  }) + '\n');
}
