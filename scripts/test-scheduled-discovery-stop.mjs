import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectJobs } from './run-linkedin-discovery.mjs';
import { runQueuedJobs } from './run-linkedin-worker.mjs';
import { openDiscoveryQueue } from '../engine/linkedin-discovery-queue.mjs';

const root = mkdtempSync(join(tmpdir(), 'bounded-discovery-'));
let clock = new Date('2026-10-12T12:00:00Z');
const now = () => new Date(clock);
const fixture = name => { const work = join(root, name); mkdirSync(work); return { work, repo: root, now, zone: 'UTC' }; };
const jobs = count => Array.from({ length: count }, (_, i) => ({ linkedinJobId: String(i + 101), url: `https://www.linkedin.com/jobs/view/${i + 101}/`, postedAt: now().getTime() }));
const state = work => JSON.parse(readFileSync(join(work, 'runtime/linkedin-discovery-queue.json'), 'utf8'));
function ingest(work, id, canonical = id) {
  const dir = join(work, 'inbox', canonical); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ linkedinJobId: id, url: `https://www.linkedin.com/jobs/view/${id}/` }));
  writeFileSync(join(dir, 'job.md'), 'Fixture job description');
}
function enrich(work, ids) {
  for (const id of ids) {
    const dir = join(work, 'inbox', id), meta = JSON.parse(readFileSync(join(dir, 'metadata.json')));
    writeFileSync(join(dir, 'enrichment.md'), '---\njobId: '+id+'\nenrichment:\n  jdCompleteness: full\n---\n## Job Description\nFixture factual description');
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ ...meta, enrichedAt: '2026-10-12' }));
  }
}
try {
  writeFileSync(join(root, '.linkedin-last-checked'), '1000\n');
  const f = fixture('batch');
  const collected = collectJobs({ ...f, search: () => jobs(100) });
  assert.equal(collected.exitCode, 0);
  assert.equal(collected.report.added.length, 100);
  assert.equal(readFileSync(join(root, '.linkedin-last-checked'), 'utf8'), '1000\n', 'collection must not advance an interactive sweep boundary');
  let fetched = 0, modelCalls = 0;
  const deps = { ...f, dailyCap: 2, ingest: entry => { fetched++; ingest(f.work, entry.linkedinJobId); return {}; },
    enrich: ids => { modelCalls++; assert.equal(ids.length, 2); enrich(f.work, ids); }, render: () => {} };
  assert.equal(runQueuedJobs(deps).exitCode, 0);
  assert.equal(fetched, 2); assert.equal(modelCalls, 1);
  assert.equal(state(f.work).entries.length, 98);
  clock = new Date(clock.getTime() + 120 * 60000);
  const capped = runQueuedJobs(deps);
  assert.equal(capped.exitCode, 0); assert.equal(capped.report.attempted.length, 0);
  assert.equal(fetched, 2); assert.equal(modelCalls, 1, 'persisted budget cannot be reset by another run');

  const partial = fixture('partial');
  collectJobs({ ...partial, search: () => jobs(1) });
  const partialDeps = { ...partial, ingest: entry => { ingest(partial.work, entry.linkedinJobId); return {}; }, render: () => {} };
  assert.equal(runQueuedJobs({ ...partialDeps, enrich: () => {} }).exitCode, 1, 'model success without artifacts is not completion');
  assert.equal(state(partial.work).entries[0].stage, 'enrich');
  clock = new Date(clock.getTime() + 120 * 60000);
  const resumed = runQueuedJobs({ ...partialDeps, ingest: () => assert.fail('must not refetch after ingestion'), enrich: ids => enrich(partial.work, ids) });
  assert.equal(resumed.exitCode, 0); assert.equal(state(partial.work).entries.length, 0);

  const stopped = fixture('stop'); let searches = 0;
  const search = () => { searches++; throw new Error('LINKEDIN_AUTH_REQUIRED: checkpoint'); };
  assert.equal(collectJobs({ ...stopped, search }).exitCode, 1);
  assert.ok(existsSync(join(stopped.work, 'linkedin-stop.json')));
  assert.ok(!existsSync(join(stopped.work, 'runtime/linkedin-collection-watermark')));
  assert.equal(collectJobs({ ...stopped, search }).exitCode, 1); assert.equal(searches, 1);
  rmSync(join(stopped.work, 'linkedin-stop.json'));
  assert.equal(collectJobs({ ...stopped, search: () => jobs(2) }).exitCode, 0);
  let details = 0;
  const stopDeps = { ...stopped, ingest: () => { details++; return { authChallenge: true }; }, enrich: () => assert.fail('checkpoint must skip enrichment'), render: () => assert.fail('checkpoint must skip rendering') };
  assert.equal(runQueuedJobs(stopDeps).exitCode, 1); assert.equal(details, 1);
  assert.equal(runQueuedJobs(stopDeps).exitCode, 1); assert.equal(details, 1);
  assert.equal(state(stopped.work).entries.length, 2);

  const duplicate = fixture('duplicate');
  collectJobs({ ...duplicate, search: () => jobs(1) });
  ingest(duplicate.work, '999', 'canonical-job');
  const dup = runQueuedJobs({ ...duplicate, ingest: () => ({ duplicate: true, duplicateOf: 'canonical-job' }), enrich: () => assert.fail('canonical duplicate is not new work'), render: () => {} });
  assert.equal(dup.exitCode, 0); assert.deepEqual(dup.report.duplicates, ['101']);
  assert.equal(state(duplicate.work).entries.length, 0);

  const excluded = fixture('excluded');
  collectJobs({ ...excluded, search: () => jobs(1) });
  const excludedResult = runQueuedJobs({ ...excluded, ingest: () => ({ excluded: true }), enrich: () => assert.fail('excluded job must not enrich'), render: () => {} });
  assert.equal(excludedResult.exitCode, 0); assert.deepEqual(excludedResult.report.excluded, ['101']);
  assert.equal(state(excluded.work).entries.length, 0);
  const limited = fixture('limited');
  const rateLimited = collectJobs({ ...limited, search: () => { throw new Error('LINKEDIN_RATE_LIMITED: HTTP 429'); } });
  assert.equal(rateLimited.exitCode, 1);
  assert.equal(JSON.parse(readFileSync(join(limited.work, 'linkedin-stop.json'))).reason, 'rate_limited');

  const busy = fixture('busy'); const lock = openDiscoveryQueue({ work: busy.work, now });
  assert.equal(collectJobs({ ...busy, search: () => assert.fail('no search while a worker owns the queue') }).exitCode, 1);
  lock.close();
  const malformed = collectJobs({ ...busy, search: () => [{ ...jobs(1)[0], url: 'https://notlinkedin.com/jobs/view/101/' }] });
  assert.equal(malformed.exitCode, 1);
  assert.ok(!existsSync(join(busy.work, 'runtime/linkedin-collection-watermark')));
  console.log('bounded discovery/worker integration and stop tests: PASS');
} finally { rmSync(root, { recursive: true, force: true }); }
