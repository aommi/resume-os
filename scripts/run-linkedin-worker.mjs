#!/usr/bin/env node
// Bounded execution only: the enrichment skill retains ATS/source judgment.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workDir, timezone } from '../engine/config.mjs';
import { assertLinkedInCooldown, recordLinkedInCooldown } from '../engine/linkedin-cooldown.mjs';
import { openDiscoveryQueue } from '../engine/linkedin-discovery-queue.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
function limit(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

export function runQueuedJobs({ work = workDir(), repo = REPO, now = () => new Date(), zone = timezone(),
  runCap = limit(process.env.LINKEDIN_WORKER_BATCH, 2, 'LINKEDIN_WORKER_BATCH'),
  dailyCap = limit(process.env.LINKEDIN_WORKER_DAILY_CAP, 10, 'LINKEDIN_WORKER_DAILY_CAP'),
  ingest, enrich, render, statusOnly = false } = {}) {
  const started = now();
  const runDir = join(work, 'runtime', 'linkedin-worker', String(started.getTime()));
  const stop = join(work, 'linkedin-stop.json');
  const hb = join(work, 'heartbeats', 'linkedin-worker.json');
  const report = { runStartedAt: started.toISOString(), attempted: [], completed: [], duplicates: [], excluded: [], failures: [], model: 'none' };
  let queue, exitCode = 0, failureCategory = '', previous = {};
  const batch = [];
  const command = (script, args = [], input) => execFileSync(process.execPath, [join(repo, 'scripts', script), ...args],
    { cwd: repo, input, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  ingest ??= entry => JSON.parse(command('retrieve-queued-job.mjs', [], JSON.stringify(entry)));
  render ??= () => command('job-board.mjs', ['render']);
  enrich ??= ids => {
    const model = JSON.parse(readFileSync(join(repo, 'engine/models.json'), 'utf8')).steps.discovery_enrich.model;
    report.model = model;
    const prompt = `Enrich ONLY these leased job IDs: ${ids.join(', ')}. Work directory: ${work}. Read job-search-sweep.md section Scheduled source-retrieval hierarchy, then load skill resume-os-enrich and follow its ATS workflow using scripts/enrich-job.mjs. Ingestion is already complete: do not run process-job.mjs again. Write factual enrichment.md and enrichedAt/atsType metadata only for these IDs. No new searches, historical catch-up, fit assessment, resume work, messages, or LinkedIn save actions. Never change scheduler queue/budget/watermark files. A LinkedIn authentication challenge requires writing ${stop} with reason auth_challenge and stopping the entire batch; do not retry it. Ordinary per-job failures may continue within this batch. The harness verifies artifacts and owns completion/retry accounting.`;
    const output = execFileSync('hermes', ['chat', '-q', prompt, '--model', model, '-Q', '-t', 'terminal,file,browser', '--max-turns', '40', '--ignore-rules'],
      { cwd: repo, encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(join(runDir, 'enrichment.log'), output, { mode: 0o600 });
  };
  function assertActive() {
    assertLinkedInCooldown({ work, now: now() });
    if (existsSync(stop)) throw Object.assign(new Error('LinkedIn is stopped; manual verification and explicit stop-file clearance required'), { code: 'LINKEDIN_STOPPED' });
  }
  function failure(error) {
    if (error.code === 'LINKEDIN_COOLDOWN' || /LINKEDIN_RATE_LIMITED:/.test(`${error.message} ${error.stderr || ''}`)) {
      try { assertLinkedInCooldown({ work, now: now() }); error.retryAt = recordLinkedInCooldown({ work, now: now(), workflow: 'linkedin-worker' }).retryAt; } catch (cooldown) {
        if (cooldown.code !== 'LINKEDIN_COOLDOWN') { error.message = cooldown.message; error.code = cooldown.code || 'COOLDOWN_STATE_INVALID'; return error; }
        if (cooldown.retryAt) error.retryAt = cooldown.retryAt;
      }
      error.code = 'LINKEDIN_COOLDOWN'; return error;
    }
    const auth = error.code === 'LINKEDIN_STOPPED' || /LINKEDIN_AUTH_REQUIRED:/.test(`${error.message}\n${error.stderr || ''}`);
    if (auth) {
      if (!existsSync(stop)) writeFileSync(stop, JSON.stringify({ reason: 'auth_challenge', detectedAt: now().toISOString(), workflow: 'linkedin-worker' }) + '\n', { mode: 0o600 });
      error.code = 'LINKEDIN_STOPPED';
    }
    return error;
  }
  try {
    if (!statusOnly) {
      mkdirSync(runDir, { recursive: true });
      mkdirSync(dirname(hb), { recursive: true });
      try { previous = JSON.parse(readFileSync(hb, 'utf8')); } catch {}
      assertActive();
    }
    queue = openDiscoveryQueue({ work, timezone: zone, now, runCap, dailyCap });
    if (!statusOnly) {
      queue.reconcile();
      let entry;
      while ((entry = queue.beginNext())) {
        const id = entry.linkedinJobId;
        report.attempted.push(id);
        try {
          assertActive();
          let canonical = entry.canonicalId || id;
          if (entry.stage === 'ingest') {
            const result = ingest(entry);
            if (result.authChallenge || result.failureCategory === 'auth_challenge') throw Object.assign(new Error('LinkedIn authentication challenge'), { code: 'LINKEDIN_STOPPED' });
            assertActive();
            if (result.excluded === true) {
              queue.acknowledgeExcluded(id);
              report.excluded.push(id);
              continue;
            }
            if (result.duplicate === true) {
              queue.acknowledgeDuplicate(id, result.duplicateOf);
              report.duplicates.push(id);
              continue;
            }
            canonical = queue.ingested(id);
            // Structured retrieval may already have persisted complete enrichment.
            try { queue.complete(id); report.completed.push(id); continue; }
            catch (error) {
              if (error.message !== 'Cannot complete without canonical ingestion and enrichment evidence') throw error;
            }
          }
          batch.push({ id, canonical });
        } catch (cause) {
          const error = failure(cause);
          if (error.code === 'LINKEDIN_COOLDOWN') queue.refundAttempt(id, { message: error.message });
          else queue.fail(id, { message: error.message });
          report.failures.push({ id, error: error.message, refunded: error.code === 'LINKEDIN_COOLDOWN' });
          if (['LINKEDIN_STOPPED', 'LINKEDIN_COOLDOWN'].includes(error.code)) throw error;
        }
      }
      if (batch.length) {
        let enrichError;
        try { assertActive(); enrich([...new Set(batch.map(item => item.canonical))]); assertActive(); }
        catch (cause) { enrichError = failure(cause); }
        for (const { id } of batch) {
          try { queue.complete(id); report.completed.push(id); }
          catch (error) {
            if (enrichError?.code === 'LINKEDIN_COOLDOWN') queue.refundAttempt(id, { message: enrichError.message });
            else queue.fail(id, { message: enrichError?.message || error.message });
            report.failures.push({ id, error: enrichError?.message || error.message, refunded: enrichError?.code === 'LINKEDIN_COOLDOWN' });
          }
        }
        batch.length = 0; // All leased items have been settled, including refunds.
        if (['LINKEDIN_STOPPED', 'LINKEDIN_COOLDOWN'].includes(enrichError?.code)) throw enrichError;
      }
      if (report.attempted.length) render();
      if (report.failures.length) throw new Error(`${report.failures.length} queued attempt(s) failed; retained for bounded retry/manual review`);
    }
  } catch (error) {
    if (error.code === 'LINKEDIN_COOLDOWN' && queue) {
      // A later retrieval can pause the whole run before earlier items enrich.
      for (const { id } of batch) {
        try { queue.complete(id); report.completed.push(id); }
        catch {
          queue.refundAttempt(id, { message: error.message });
          report.failures.push({ id, error: error.message, refunded: true });
        }
      }
    }
    report.error = error.message;
    if (error.retryAt) report.retryAt = error.retryAt;
    exitCode = 1;
    failureCategory = error.code === 'LINKEDIN_COOLDOWN' ? 'linkedin_cooldown' : error.code === 'LINKEDIN_STOPPED' ? 'linkedin_stopped' : error.code === 'QUEUE_LOCKED' ? 'queue_busy' : error.code === 'CANONICAL_METADATA_INVALID' ? 'canonical_metadata_invalid' : 'worker_failed';
  } finally {
    if (queue) { report.queue = queue.summary(); queue.close(); }
    // Retry exhaustion remains an operational problem until explicitly repaired.
    if (!statusOnly && exitCode === 0 && report.queue?.blocked) {
      exitCode = 1;
      failureCategory = 'queue_needs_review';
      report.error = `${report.queue.blocked} queued job(s) exhausted retries and require manual review`;
    }
    if (!statusOnly) {
      writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
      writeFileSync(hb, JSON.stringify({ workflow: 'linkedin-worker', cadenceMinutes: 120,
        lastAttempt: started.toISOString(), lastSuccess: exitCode === 0 ? now().toISOString() : previous.lastSuccess || null,
        exitCode, failureCategory, runDir, model: report.model, queue: report.queue }) + '\n');
    }
  }
  return { exitCode, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const statusOnly = process.argv.includes('--status');
  const retryIndex = process.argv.indexOf('--retry');
  const dismissIndex = process.argv.indexOf('--dismiss');
  if (retryIndex !== -1 || dismissIndex !== -1) {
    const queue = openDiscoveryQueue({ work: workDir(), timezone: timezone() });
    try {
      if (retryIndex !== -1) {
        const id = process.argv[retryIndex + 1];
        if (!id) throw new Error('usage: run-linkedin-worker.mjs --retry <linkedin-job-id>');
        console.log(JSON.stringify({ retried: queue.retry(id) }, null, 2));
      } else {
        const id = process.argv[dismissIndex + 1];
        if (!id) throw new Error('usage: run-linkedin-worker.mjs --dismiss <linkedin-job-id> --reason <text>');
        const reasonIndex = process.argv.indexOf('--reason');
        const reason = reasonIndex === -1 ? '' : process.argv[reasonIndex + 1];
        if (!reason?.trim() || reason.startsWith('--')) throw new Error('Dismissal requires --reason <nonempty text>');
        console.log(JSON.stringify(queue.dismiss(id, { reason }), null, 2));
      }
    } finally { queue.close(); }
    process.exit(0);
  }
  const result = runQueuedJobs({ statusOnly });
  const r = result.report, q = r.queue;
  console.log(statusOnly || process.argv.includes('--json') ? JSON.stringify(r, null, 2) :
    result.exitCode === 0 && !r.attempted.length ? '[SILENT]' :
    `Resume OS processing: ${r.completed.length} completed, ${r.duplicates.length} duplicates, ${r.excluded.length} excluded, ${r.failures.length} failed.\nWaiting: ${q?.pending ?? 'unknown'}; needs review: ${q?.blocked ?? 'unknown'}; budget remaining today: ${q?.remainingToday ?? 'unknown'}.\nOldest waiting: ${q?.oldestQueuedAt || 'none'}.${r.error ? `\n${r.error}` : ''}`);
  process.exitCode = result.exitCode;
}
