#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDiscoveryQueue } from '../engine/linkedin-discovery-queue.mjs';
import { runQueuedJobs } from './run-linkedin-worker.mjs';
import { dispatchHandoffs, recordEnrichedHandoff, browserOwnershipPath } from '../engine/pipeline-handoff.mjs';

const root = mkdtempSync(join(tmpdir(), 'handoff-test-'));
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const wrapper = join(repo, 'scripts/with-browser-ownership.py');
const owner = join(root, 'owner.mjs');
writeFileSync(owner, `import {readFileSync,appendFileSync} from 'node:fs';
const r=JSON.parse(readFileSync(0,'utf8'));
appendFileSync(process.argv[2],JSON.stringify(r)+'\\n');
if(process.argv[3]==='fail') process.exit(9);
console.log(JSON.stringify({runId:r.runId,acceptedJobIds:r.jobIds,outcome:process.argv[3]||'prepared'}));`);
const events = work => readdirSync(join(work, 'runtime/pipeline-handoff')).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => JSON.parse(readFileSync(join(work, 'runtime/pipeline-handoff', n))));
const read = path => JSON.parse(readFileSync(path));
function fixture(name, outcome = 'prepared') {
  const profile = join(root, name), work = join(profile, 'work'), log = join(profile, 'accepted.jsonl');
  mkdirSync(work, { recursive: true });
  const config = { profileId: name, pipelineHandoff: { enabled: true, contractVersion: 1, command: [process.execPath, owner, log, outcome] } };
  writeFileSync(join(profile, 'profile.json'), JSON.stringify(config));
  writeFileSync(join(profile, 'application-policy.json'), JSON.stringify({ enabled: true, autoSubmit: false }));
  return { profile, work, repo, log, config, zone: 'UTC' };
}
function evidence(f, id, meta = {}) {
  const dir = join(f.work, 'inbox', id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ linkedinJobId: id, enrichedAt: '2026-01-01', ...meta }));
  writeFileSync(join(dir, 'job.md'), 'Fictional source JD');
  writeFileSync(join(dir, 'enrichment.md'), `---\njobId: ${id}\nenrichment:\n  jdCompleteness: full\n---\n## Job Description\nFictional complete description`);
}
const waitFor = async fn => {
  for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('Fixture readiness timed out');
};
try {
  // Normal worker path: real configured argv owner consumes first completed
  // enrichment before another slow/failing entry is even ingested.
  const f = fixture('incremental');
  const q = openDiscoveryQueue({ work: f.work, runCap: 3 });
  q.enqueue(['101', '102', '103'].map(id => ({ linkedinJobId: id, url: `https://www.linkedin.com/jobs/view/${id}/` }))); q.close();
  const result = runQueuedJobs({ ...f, runCap: 3, ingest: entry => {
    if (entry.linkedinJobId !== '101') assert.ok(existsSync(f.log), 'first completion must reach owner before unrelated work');
    if (entry.linkedinJobId === '102') throw new Error('Unrelated extraction failure');
    const dir = join(f.work, 'inbox', entry.linkedinJobId); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ linkedinJobId: entry.linkedinJobId }));
    writeFileSync(join(dir, 'job.md'), 'Fictional job'); return {};
  }, enrich: ids => ids.forEach(id => evidence(f, id)), render: () => {} });
  assert.equal(result.exitCode, 1, 'partial failure remains visible');
  assert.deepEqual(result.report.completed, ['101', '103']);
  assert.equal(result.report.failures.length, 1);
  const requests = readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(requests.map(r => r.jobIds), [['101'], ['103']]);
  assert.ok(requests.every(r => r.mode === 'review-only' && r.stage === 'enriched'));
  assert.equal(result.report.handoff.newReceiptConfirmedApplications, 0);
  assert.equal(read(join(f.work, 'inbox/101/metadata.json')).lifecycle, undefined);
  dispatchHandoffs(f); recordEnrichedHandoff({ work: f.work, jobId: '101' }); dispatchHandoffs(f);
  assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 2, 'restarts/duplicate events do not relaunch');
  assert.ok(events(f.work).every(e => e.status === 'consumed' && e.acceptedJobIds.length === 1));

  // Exact employer requisition aliases collapse; unrelated same title does not.
  const aliases = fixture('aliases');
  for (const id of ['201', '202']) { evidence(aliases, id, { employerRequisitionSource: 'fictional:tenant', employerRequisitionId: 'req-1' }); recordEnrichedHandoff({ work: aliases.work, jobId: id }); }
  assert.equal(events(aliases.work).length, 1);
  assert.deepEqual(events(aliases.work)[0].jobIds, ['201', '202']);
  dispatchHandoffs(aliases); assert.deepEqual(events(aliases.work)[0].acceptedJobIds, ['201', '202']);
  // Later identity evidence and case-only aliases cannot replay a consumed job.
  evidence(f, '101', { employerRequisitionSource: 'fictional:new-tenant', employerRequisitionId: 'REQ-2' });
  recordEnrichedHandoff({ work: f.work, jobId: '101' });
  evidence(f, '104', { employerRequisitionSource: 'fictional:new-tenant', employerRequisitionId: 'req-2' });
  recordEnrichedHandoff({ work: f.work, jobId: '104' }); dispatchHandoffs(f);
  assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 2);
  assert.equal(events(f.work).length, 2);

  for (const mode of ['disabled', 'paused', 'stopped', 'revoked', 'applied']) {
    const f = fixture(mode); evidence(f, '301', mode === 'applied' ? { lifecycle: { status: 'applied', appliedAt: '2026-01-01' } } : {});
    recordEnrichedHandoff({ work: f.work, jobId: '301' });
    if (mode === 'disabled') writeFileSync(join(f.profile, 'profile.json'), JSON.stringify({ pipelineHandoff: { ...f.config.pipelineHandoff, enabled: false } }));
    if (mode === 'paused') writeFileSync(join(f.profile, 'application-policy.json'), JSON.stringify({ enabled: true, paused: true }));
    if (mode === 'revoked') writeFileSync(join(f.profile, 'application-policy.json'), JSON.stringify({ enabled: false }));
    if (mode === 'stopped') writeFileSync(join(f.work, 'pipeline-stop.json'), '{}');
    dispatchHandoffs(f); assert.equal(existsSync(f.log), false, mode);
    assert.equal(events(f.work)[0].status, mode === 'applied' ? 'held' : 'pending');
  }
  // Exit zero is insufficient; no applied status can be manufactured by owner.
  for (const outcome of ['fail', 'applied', 'uncertain']) {
    const f = fixture('owner-' + outcome, outcome); evidence(f, '401'); recordEnrichedHandoff({ work: f.work, jobId: '401' });
    dispatchHandoffs(f); assert.equal(events(f.work)[0].status, 'uncertain');
    dispatchHandoffs(f); assert.equal(readFileSync(f.log, 'utf8').trim().split('\n').length, 1);
    assert.equal(read(join(f.work, 'inbox/401/metadata.json')).lifecycle, undefined);
  }
  // Crash between enrichment and queue acknowledgement recovers durable event.
  const crash = fixture('crash'); const cq = openDiscoveryQueue({ work: crash.work });
  cq.enqueue([{ linkedinJobId: '501', url: 'https://www.linkedin.com/jobs/view/501/' }]);
  evidence(crash, '501'); cq.reconcile(); cq.close();
  assert.equal(events(crash.work)[0].status, 'pending'); dispatchHandoffs(crash);

  // Overlapping schedulers: first launch deliberately blocks; second cannot claim.
  const overlap = fixture('overlap'); evidence(overlap, '601'); recordEnrichedHandoff({ work: overlap.work, jobId: '601' });
  const slow = join(root, 'slow.mjs'), ready = join(root, 'owner-ready'), done = join(root, 'owner-done');
  writeFileSync(slow, `import {existsSync,writeFileSync,readFileSync} from 'node:fs'; const r=JSON.parse(readFileSync(0,'utf8')); writeFileSync(${JSON.stringify(ready)},'ready'); while(!existsSync(${JSON.stringify(done)})) await new Promise(r=>setTimeout(r,10)); console.log(JSON.stringify({runId:r.runId,acceptedJobIds:r.jobIds,outcome:'prepared'}));`);
  writeFileSync(join(overlap.profile, 'profile.json'), JSON.stringify({ pipelineHandoff: { ...overlap.config.pipelineHandoff, command: [process.execPath, slow] } }));
  const moduleURL = new URL('../engine/pipeline-handoff.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {dispatchHandoffs} from ${JSON.stringify(moduleURL)}; dispatchHandoffs(${JSON.stringify(overlap)});`], { stdio: 'pipe' });
  try {
    await waitFor(() => existsSync(ready));
    assert.equal(dispatchHandoffs(overlap).busy, true);
    writeFileSync(done, 'done');
    await new Promise((ok, fail) => child.on('exit', code => code === 0 ? ok() : fail(new Error(`dispatcher exit ${code}`))));
    assert.equal(events(overlap.work)[0].status, 'consumed');
  } finally { if (child.exitCode === null) child.kill('SIGKILL'); }

  // Real POSIX browser lease: inherited by child, not stale PID/age metadata.
  const lock = browserOwnershipPath(join(root, 'browser')), live = join(root, 'browser-live'), release = join(root, 'browser-release');
  const browserChild = join(root, 'browser-child.mjs');
  writeFileSync(browserChild, `import {existsSync,writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(live)},'live'); while(!existsSync(${JSON.stringify(release)})) await new Promise(r=>setTimeout(r,10));`);
  const holder = spawn('python3', [wrapper, '--lock', lock, '--', process.execPath, browserChild], { stdio: 'ignore' });
  const compete = () => spawnSync('python3', [wrapper, '--lock', lock, '--', process.execPath, '-e', 'process.exit(0)'], { encoding: 'utf8' });
  try {
    await waitFor(() => existsSync(live)); assert.equal(compete().status, 75);
    // The normal default ingestion subprocess is refused before executing;
    // browser contention must not exhaust per-job or daily retry budgets.
    const busy = fixture('browser-busy');
    const bq = openDiscoveryQueue({ work: busy.work });
    bq.enqueue([{ linkedinJobId: '701', url: 'https://www.linkedin.com/jobs/view/701/' }]); bq.close();
    // Hold this worker's exact resource, not the unrelated fixture's lease.
    const ownLock = browserOwnershipPath(busy.work);
    const ownReady = join(root, 'busy-ready');
    const ownChild = spawn('python3', [wrapper, '--lock', ownLock, '--', process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ownReady)},'ready');setInterval(()=>{},1000)`], { stdio: 'ignore' });
    try {
      await waitFor(() => existsSync(ownReady));
      const busyResult = runQueuedJobs({ ...busy, enrich: () => assert.fail('no browser enrichment'), render: () => {} });
      assert.equal(busyResult.exitCode, 1);
      assert.equal(busyResult.report.failures[0].refunded, true);
      assert.equal(busyResult.report.queue.attemptsToday, 0);
      assert.equal(read(join(busy.work, 'heartbeats/linkedin-worker.json')).failureCategory, 'browser_busy');
    } finally { ownChild.kill('SIGTERM'); await new Promise(r => ownChild.on('exit', r)); }
    holder.kill('SIGKILL'); await new Promise(r => holder.on('exit', r));
    assert.equal(compete().status, 75, 'dead wrapper must not steal live child browser session');
  } finally { writeFileSync(release, 'release'); }
  await waitFor(() => compete().status === 0);
  // File still exists: released kernel lease recovers without unlinking/stealing.
  assert.ok(existsSync(lock));
  // Cancellation after owner launch terminates that exact foreground run and
  // leaves an uncertain event, never silently re-enabling or replaying it.
  const cancel = fixture('cancel'); evidence(cancel, '801'); recordEnrichedHandoff({ work: cancel.work, jobId: '801' });
  const cancelReady = join(root, 'cancel-ready'), cancelOwner = join(root, 'cancel-owner.mjs');
  writeFileSync(cancelOwner, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(cancelReady)},'ready');setInterval(()=>{},1000);`);
  writeFileSync(join(cancel.profile, 'profile.json'), JSON.stringify({ pipelineHandoff: { ...cancel.config.pipelineHandoff, command: [process.execPath, cancelOwner] } }));
  const cancelRun = spawn(process.execPath, ['--input-type=module', '-e', `import {dispatchHandoffs} from ${JSON.stringify(moduleURL)}; dispatchHandoffs(${JSON.stringify(cancel)});`], { stdio: 'pipe' });
  try {
    await waitFor(() => existsSync(cancelReady));
    writeFileSync(join(cancel.profile, 'application-policy.json'), JSON.stringify({ enabled: false }));
    await new Promise((ok, fail) => cancelRun.on('exit', code => code === 0 ? ok() : fail(new Error(`cancel dispatcher exit ${code}`))));
    assert.equal(events(cancel.work)[0].status, 'uncertain');
    dispatchHandoffs(cancel); assert.equal(events(cancel.work)[0].status, 'uncertain');
    assert.equal(read(join(cancel.profile, 'application-policy.json')).enabled, false);
  } finally { if (cancelRun.exitCode === null) cancelRun.kill('SIGKILL'); }
  // A persisted running claim without an acknowledgment is held on restart.
  const lost = fixture('lost-ack'); evidence(lost, '901');
  const lostPath = recordEnrichedHandoff({ work: lost.work, jobId: '901' });
  writeFileSync(lostPath, JSON.stringify({ ...read(lostPath), status: 'running', runId: 'old-unacknowledged-run' }));
  dispatchHandoffs(lost); assert.equal(events(lost.work)[0].status, 'uncertain'); assert.equal(existsSync(lost.log), false);
  // execFileSync timeout must bound cleanup even if TERM is ignored by owner
  // and its lease-inheriting descendant. Unknown work cannot become safe retry.
  const stubborn = fixture('stubborn-timeout'); evidence(stubborn, '950');
  const stubbornPath = recordEnrichedHandoff({work:stubborn.work,jobId:'950'});
  const stubbornOwner = join(root,'stubborn.py'), stubbornPid = join(root,'stubborn.pid');
  writeFileSync(stubbornOwner, `import os,signal,subprocess,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nfd=int(os.environ['RESUME_OS_BROWSER_LEASE_FD'])\nsubprocess.Popen(['python3','-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)'],pass_fds=(fd,))\nopen(${JSON.stringify(stubbornPid)},'w').write(str(os.getpid()))\nwhile True: time.sleep(1)\n`);
  writeFileSync(join(stubborn.profile,'profile.json'),JSON.stringify({pipelineHandoff:{...stubborn.config.pipelineHandoff,command:['python3',stubbornOwner],timeoutMs:200}}));
  const began=Date.now();
  const timed=spawnSync(process.execPath,['--input-type=module','-e',`import {dispatchHandoffs} from ${JSON.stringify(moduleURL)};dispatchHandoffs(${JSON.stringify(stubborn)});`],{encoding:'utf8',timeout:5000});
  assert.equal(timed.status,0,timed.stderr || timed.error?.message);
  assert.ok(Date.now()-began<3000,'stubborn timeout cleanup must be bounded');
  assert.ok(existsSync(stubbornPid),'fixture must actually start and ignore TERM');
  const pid=Number(readFileSync(stubbornPid));
  assert.throws(()=>process.kill(pid,0),e=>e.code==='ESRCH','direct owner reaped');
  assert.equal(read(stubbornPath).status,'uncertain');
  const freed=spawnSync('python3',[wrapper,'--lock',browserOwnershipPath(stubborn.work),'--',process.execPath,'-e','process.exit(0)'],{encoding:'utf8',timeout:3000});
  assert.equal(freed.status,0,'descendant must not retain inherited browser lease');
  const oldRun=read(stubbornPath).runId;dispatchHandoffs(stubborn);assert.equal(read(stubbornPath).runId,oldRun);
  console.log('stubborn TERM-ignoring owner timeout: PASS (bounded KILL, group lease cleanup, uncertain/no replay)');
  console.log('pipeline handoff: PASS (incremental normal worker, real owner argv/acks, aliases, partial failure, restart/dedup, policy stops/revocation, uncertain outcomes, overlapping schedulers, inherited browser lease, busy-budget refund)');
} finally { rmSync(root, { recursive: true, force: true }); }
