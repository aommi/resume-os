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
  assert.equal(existsSync(join(limited.work, 'linkedin-stop.json')), false);
  assert.equal(JSON.parse(readFileSync(join(limited.work, 'runtime/linkedin-cooldown.json'))).reason, 'rate_limited');
  assert.equal(collectJobs({ ...limited, search: () => assert.fail('no search while cooling down') }).exitCode, 1);
  const coolingWorker = runQueuedJobs({ ...limited, ingest: () => assert.fail('no ingestion while cooling down'), enrich: () => assert.fail('no model while cooling down'), render: () => {} });
  assert.equal(coolingWorker.exitCode, 1);
  assert.equal(coolingWorker.report.attempted.length, 0);
  assert.equal(JSON.parse(readFileSync(join(limited.work, 'heartbeats/linkedin-worker.json'))).failureCategory, 'linkedin_cooldown');

  clock = new Date(Date.parse(JSON.parse(readFileSync(join(limited.work, 'runtime/linkedin-cooldown.json'))).retryAt) + 1);
  assert.equal(collectJobs({ ...limited, search: () => [] }).exitCode, 0, 'ordinary collection resumes after expiry without clearing auth state');

  const busy = fixture('busy'); const lock = openDiscoveryQueue({ work: busy.work, now });
  assert.equal(collectJobs({ ...busy, search: () => assert.fail('no search while a worker owns the queue') }).exitCode, 1);
  lock.close();
  const malformed = collectJobs({ ...busy, search: () => [{ ...jobs(1)[0], url: 'https://notlinkedin.com/jobs/view/101/' }] });
  assert.equal(malformed.exitCode, 1);
  assert.ok(!existsSync(join(busy.work, 'runtime/linkedin-collection-watermark')));
  const structured = fixture('structured');
  collectJobs({ ...structured, search: () => jobs(1) });
  const structuredResult = runQueuedJobs({ ...structured,
    ingest: entry => { ingest(structured.work, entry.linkedinJobId); enrich(structured.work, [entry.linkedinJobId]); return {}; },
    enrich: () => assert.fail('complete structured retrieval requires no enrichment model'), render: () => {} });
  assert.equal(structuredResult.exitCode, 0);
  assert.deepEqual(structuredResult.report.completed, ['101']);
  assert.equal(state(structured.work).entries.length, 0);

  const exhausted = fixture('exhausted');
  collectJobs({ ...exhausted, search: () => jobs(1) });
  const exhaustedDeps = { ...exhausted, ingest: () => { throw new Error('Fixture extraction failure'); }, enrich: () => assert.fail('failed ingestion'), render: () => {} };
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(runQueuedJobs(exhaustedDeps).exitCode, 1);
    clock = new Date(clock.getTime() + 5 * 3600000);
  }
  const idleBlocked = runQueuedJobs(exhaustedDeps);
  assert.equal(idleBlocked.exitCode, 1);
  assert.equal(idleBlocked.report.attempted.length, 0);
  assert.equal(idleBlocked.report.queue.blocked, 1);
  const blockedHeartbeat = JSON.parse(readFileSync(join(exhausted.work, 'heartbeats/linkedin-worker.json')));
  assert.equal(blockedHeartbeat.failureCategory, 'queue_needs_review');
  assert.equal(blockedHeartbeat.lastSuccess, null);

  const corrupt = fixture('corrupt');
  collectJobs({ ...corrupt, search: () => jobs(1) });
  ingest(corrupt.work, '999');
  writeFileSync(join(corrupt.work, 'inbox/999/metadata.json'), '{');
  const corruptResult = runQueuedJobs({ ...corrupt, ingest: () => assert.fail('repair barrier before external work'), enrich: () => assert.fail('repair barrier before model'), render: () => {} });
  assert.equal(corruptResult.exitCode, 1);
  assert.match(corruptResult.report.error, /metadata requires repair/);
  assert.equal(state(corrupt.work).entries.length, 1);
  assert.equal(JSON.parse(readFileSync(join(corrupt.work, 'heartbeats/linkedin-worker.json'))).failureCategory, 'canonical_metadata_invalid');

  // Exercise the real default execFileSync handoff, not an injected ingest function.
  const ipc = fixture('ipc');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  collectJobs({ ...ipc, search: () => jobs(1) });
  writeFileSync(join(root, 'scripts/retrieve-queued-job.mjs'), `
    import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    const entry = JSON.parse(readFileSync(0, 'utf8'));
    if (entry.linkedinJobId !== '101') throw new Error('Missing or wrong leased entry');
    const dir = join(${JSON.stringify(ipc.work)}, 'inbox', entry.linkedinJobId);
    mkdirSync(dir, {recursive:true});
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify({...entry, enrichedAt:'2026-10-13'}));
    writeFileSync(join(dir, 'job.md'), 'Source-backed fixture description');
    writeFileSync(join(dir, 'enrichment.md'), '---\\njobId: 101\\nenrichment:\\n  jdCompleteness: partial\\n---\\n## Job Description\\nSource-backed fixture description');
    console.log(JSON.stringify({linkedinJobId:entry.linkedinJobId}));
  `);
  const ipcResult = runQueuedJobs({ ...ipc, enrich: () => assert.fail('structured child output requires no model'), render: () => {} });
  assert.equal(ipcResult.exitCode, 0, JSON.stringify(ipcResult.report));
  assert.deepEqual(ipcResult.report.completed, ['101']);
  assert.equal(ipcResult.report.queue.pending, 0);

  console.log('bounded discovery/worker integration and stop tests: PASS');
} finally { rmSync(root, { recursive: true, force: true }); }
