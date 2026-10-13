#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openDiscoveryQueue, validateDiscoveryJob } from '../engine/linkedin-discovery-queue.mjs';

const root = mkdtempSync(join(tmpdir(), 'linkedin-queue-test-'));
let clock = new Date('2026-01-01T12:00:00Z');
const now = () => clock;
const job = id => ({ linkedinJobId: id, url: `https://www.linkedin.com/jobs/view/${id}/` });
function open(name, opts = {}) { return openDiscoveryQueue({ work: join(root, name), now, ...opts }); }
function evidence(name, id, enriched = false) {
  const path = join(root, name, 'inbox', `canonical-${id}`);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'metadata.json'), JSON.stringify({ linkedinJobId: id, ...(enriched ? { enrichedAt: now().toISOString() } : {}) }));
  writeFileSync(join(path, 'job.md'), 'Factual source JD');
  if (enriched) writeFileSync(join(path, 'enrichment.md'), `---\njobId: canonical-${id}\nenrichment:\n  jdCompleteness: full\n---\n\n## Job Description\n\nSource-backed enrichment\n`);
}
try {
  for (const bad of ['../1', '1/2', ' 123', '001', 123, '', '1e3']) assert.throws(() => validateDiscoveryJob(job(bad)));
  for (const url of ['https://linkedin.com.evil/jobs/view/123/', 'http://linkedin.com/jobs/view/123/', 'https://linkedin.com/jobs/view/124/?currentJobId=123', 'https://linkedin.com/jobs/search/?currentJobId=123', 'https://a:b@linkedin.com/jobs/view/123/', 'https://linkedin.com/jobs/view/123/extra']) assert.throws(() => validateDiscoveryJob({ linkedinJobId: '123', url }));
  assert.equal(validateDiscoveryJob({ linkedinJobId: '123', url: 'https://ca.linkedin.com/jobs/view/product-owner-123/?trackingId=a' }).url, job('123').url);

  assert.deepEqual(validateDiscoveryJob({ ...job('123'), title: 'Engineer', company: 'Example', location: 'Remote', postedAt: 1234, score: 99 }), { ...job('123'), title: 'Engineer', company: 'Example', location: 'Remote', postedAt: 1234 });

  let q = open('core');
  assert.deepEqual(q.enqueue([job('1'), job('2'), job('1')]), { added: ['1', '2'], duplicates: ['1'] });
  assert.throws(() => open('core'), { code: 'QUEUE_LOCKED' });
  assert.throws(() => q.enqueue([job('3'), job('../4')]));
  assert.equal(q.summary().pending, 2);
  assert.equal(q.beginNext().linkedinJobId, '1');
  evidence('core', '1'); q.ingested('1');
  assert.equal(q.beginNext().linkedinJobId, '2');
  assert.equal(q.beginNext(), null);
  assert.equal(q.summary().runUsed, 2);
  assert.throws(() => q.complete('1'));
  q.fail('1', { message: 'Temporary enrichment error' });
  q.fail('2', { message: 'Temporary ingest error' });
  q.close();
  clock = new Date(clock.getTime() + 3600001);
  q = open('core');
  assert.equal(q.beginNext().stage, 'enrich'); // Never refetch persisted ingestion.
  evidence('core', '1', true); q.complete('1');
  assert.deepEqual(q.enqueue([job('1')]).duplicates, ['1']);
  q.close();
  assert.equal(JSON.parse(readFileSync(join(root, 'core/runtime/linkedin-discovery-queue.json'))).entries.some(e => e.linkedinJobId === '1'), false);

  q = open('budget', { dailyCap: 2 });
  q.enqueue([job('3'), job('4'), job('5')]);
  q.beginNext(); q.beginNext(); q.close();
  q = open('budget', { dailyCap: 2 });
  assert.equal(q.beginNext(), null); assert.equal(q.summary().dailyUsed, 2); q.close();
  clock = new Date('2026-01-02T01:00:00Z');
  q = open('budget', { dailyCap: 2 });
  assert.equal(q.summary().dailyUsed, 0); q.close();

  clock = new Date('2026-01-02T07:59:00Z');
  q = open('timezone', { timezone: 'America/Vancouver', dailyCap: 1 });
  q.enqueue([job('9'), job('10')]); q.beginNext(); q.close();
  clock = new Date('2026-01-02T08:01:00Z');
  q = open('timezone', { timezone: 'America/Vancouver', dailyCap: 1 });
  assert.equal(q.summary().dailyUsed, 0); assert.equal(q.beginNext().linkedinJobId, '10'); q.close();

  q = open('retry'); q.enqueue([job('6')]); q.close();
  for (let attempt = 1; attempt <= 3; attempt++) {
    q = open('retry'); assert.equal(q.beginNext().attempts, attempt); q.fail('6'); q.close();
    clock = new Date(clock.getTime() + 5 * 3600000);
  }
  q = open('retry'); assert.equal(q.beginNext(), null); assert.equal(q.summary().blocked, 1); q.close();

  q = open('duplicate'); q.enqueue([job('20')]); q.beginNext(); evidence('duplicate', '21');
  assert.throws(() => q.acknowledgeDuplicate('20', '../canonical-21'));
  assert.throws(() => q.acknowledgeDuplicate('20', 'missing'));
  assert.equal(q.summary().pending, 1);
  q.acknowledgeDuplicate('20', 'canonical-21');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'duplicate/inbox/canonical-21/metadata.json'))).linkedinAliases, ['20']);
  assert.deepEqual(q.enqueue([job('20')]).duplicates, ['20']);
  assert.equal(q.summary().pending, 0); q.close();

  q = open('excluded'); q.enqueue([job('22')]); q.beginNext(); q.acknowledgeExcluded('22');
  assert.equal(q.summary().pending, 0); q.close();

  // A terminated process leaves charged attempts and a recoverable local-owner lock.
  const work = join(root, 'crash');
  const moduleURL = new URL('../engine/linkedin-discovery-queue.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { openDiscoveryQueue } from ${JSON.stringify(moduleURL)};
    const q = openDiscoveryQueue({work:${JSON.stringify(work)},now:()=>new Date('2026-01-01T12:00:00Z')});
    q.enqueue([${JSON.stringify(job('7'))}]); q.beginNext(); process.exit(0);
  `], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const recoveryPath = join(work, 'runtime/linkedin-discovery-queue.json.lock.recovery');
  writeFileSync(recoveryPath, readFileSync(join(work, 'runtime/linkedin-discovery-queue.json.lock')));
  assert.throws(() => open('crash'), /recovery is locked.*manual review/);
  rmSync(recoveryPath); // Explicit operator remediation of confirmed dead recovery owner.
  clock = new Date('2026-01-01T14:00:00Z');
  q = open('crash'); assert.equal(q.summary().dailyUsed, 1); assert.equal(q.beginNext().attempts, 2); q.close();
  const statePath = join(work, 'runtime/linkedin-discovery-queue.json');
  writeFileSync(`${statePath}.lock`, JSON.stringify({ hostname: 'some-other-host', pid: 2147483647, token: 'foreign' }));
  assert.throws(() => open('crash'), { code: 'QUEUE_LOCKED' });
  rmSync(`${statePath}.lock`);
  // Crash between canonical enrichment write and queue acknowledgement is reconciled.
  evidence('crash', '7', true); q = open('crash'); q.reconcile();
  assert.equal(q.summary().pending, 0); assert.equal(q.summary().blocked, 0); q.close();
  assert.equal(existsSync(`${statePath}.lock`), false);

  // Incomplete enrichment is retained; no optimistic completion after a partial write.
  q = open('partial'); q.enqueue([job('8')]); q.beginNext(); evidence('partial', '8');
  writeFileSync(join(root, 'partial/inbox/canonical-8/enrichment.md'), 'Partial model output');
  q.reconcile(); assert.equal(q.summary().pending, 1); assert.throws(() => q.complete('8')); q.close();
  // Corruption is a named repair barrier, preserving work rather than guessing identity.
  q = open('corrupt'); q.enqueue([job('30')]);
  evidence('corrupt', '99');
  const corruptMetadata = join(root, 'corrupt/inbox/canonical-99/metadata.json');
  writeFileSync(corruptMetadata, '{');
  assert.throws(() => q.reconcile(), error => error.code === 'CANONICAL_METADATA_INVALID' && error.message.includes(corruptMetadata));
  assert.equal(q.summary().pending, 1);
  q.close();
  writeFileSync(corruptMetadata, JSON.stringify({ linkedinJobId: '99' }));
  q = open('corrupt'); assert.equal(q.beginNext().linkedinJobId, '30'); q.close();
  assert.equal(validateDiscoveryJob({ ...job('31'), applyUrl: 'https://example.com/jobs/31', sourceEvidence: { linkedinJobId: '31' } }).applyUrl, 'https://example.com/jobs/31');
  assert.throws(() => validateDiscoveryJob({ ...job('31'), applyUrl: 'javascript:alert(1)', sourceEvidence: { linkedinJobId: '31' } }));

  console.log('LinkedIn discovery queue: identity guards, deduplication, run/day caps, retry backoff, stage recovery, dead/live/foreign locks, and crash reconciliation passed.');
} finally { rmSync(root, { recursive: true, force: true }); }
