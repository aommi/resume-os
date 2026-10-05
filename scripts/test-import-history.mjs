import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Run the real importer against a synthetic work directory, with a render stub.
const root = mkdtempSync(join(tmpdir(), 'import-history-'));
const work = join(root, 'work');
const metadata = join(work, 'inbox/123/metadata.json');
const invitationAt = new Date(Date.now() + 30 * 86400000).toISOString();
let sequence = 0;
try {
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'engine'));
  mkdirSync(join(work, 'inbox/123'), { recursive: true });
  mkdirSync(join(work, 'events/pending'), { recursive: true });
  cpSync('scripts/import-events.mjs', join(root, 'scripts/import-events.mjs'));
  writeFileSync(join(root, 'engine/config.mjs'), `export const workDir = () => ${JSON.stringify(work)}; export const timezone = () => 'UTC'; export const loadProfile = () => ({});`);
  cpSync('scripts/job-board.mjs', join(root, 'scripts/job-board.mjs'));
  for (const name of ['watchdog-health.mjs', 'job-screenability.mjs', 'job-exclusions.mjs', 'job-identity.mjs']) {
    cpSync(join('engine', name), join(root, 'engine', name));
  }
  function seed(lifecycle) {
    writeFileSync(metadata, JSON.stringify({ company: 'Example', title: 'Product Manager', lifecycle: {
      status: 'applied', appliedAt: '2026-09-01', lastContactAt: '2026-09-01', emailEvents: [], ...lifecycle,
    } }));
  }
  function importMail(events) {
    writeFileSync(join(work, 'events/pending', `fixture-${++sequence}.md`), events.map(event =>
      '## JOB_EMAIL_EVENT\n' + Object.entries({ job_id: '123', company: 'Example', role: 'Product Manager', confidence: 'high', message_id: `fixture-${++sequence}`, ...event })
        .map(([key, value]) => `- ${key}: ${value}`).join('\n')
    ).join('\n'));
    const run = spawnSync(process.execPath, ['scripts/import-events.mjs'], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(readFileSync(metadata, 'utf8')).lifecycle;
  }
  const information = { event: 'other', event_date: '2026-09-20' };
  const interview = { event: 'interview', event_date: '2026-09-19', next_event_at: invitationAt };

  // Both input orders, including separate importer invocations, produce an interview.
  for (const order of [[information, interview], [interview, information]]) {
    seed({});
    let result;
    for (const event of order) result = importMail([event]);
    assert.equal(result.status, 'interviewing');
    assert.equal(result.nextEventAt, invitationAt);
    assert.equal(result.lastContactAt, '2026-09-20');
    assert.equal(result.stateChangedAt, '2026-09-19');
    assert.equal(result.emailEvents.length, 2);
  }

  // A later terminal transition still suppresses older invitations and confirmations.
  for (const order of [
    [{ event: 'rejection', event_date: '2026-09-21' }, information, interview],
    [interview, information, { event: 'rejection', event_date: '2026-09-21' }],
  ]) {
    seed({});
    const result = importMail(order);
    assert.equal(result.status, 'closed');
    assert.equal(result.outcome, 'Rejected');
    assert.equal(result.nextEventAt, '');
    assert.equal(result.stateChangedAt, '2026-09-21');
  }

  // Manual/legacy state boundaries survive a newer informational contact.
  seed({ status: 'interviewing', lastContactAt: '2026-09-20', outcome: 'Interview' });
  importMail([{ event: 'other', event_date: '2026-09-22' }]);
  let result = importMail([{ event: 'confirmation', event_date: '2026-09-03' }]);
  assert.equal(result.status, 'interviewing');
  assert.equal(result.lastContactAt, '2026-09-22');
  assert.equal(result.stateChangedAt, '2026-09-20');
  seed({ appliedAt: '2026-09-23', lastContactAt: '', emailEvents: [{ event: 'other', date: '2026-09-24' }] });
  result = importMail([interview]);
  assert.equal(result.status, 'applied');
  assert.equal(result.nextEventAt, '');
  assert.equal(result.stateChangedAt, '2026-09-23');

  // Subject-based action-required transitions remain dated even for `other` mail.
  seed({});
  importMail([{ event: 'other', event_date: '2026-09-21', subject: 'Action required: assessment' }]);
  result = importMail([interview]);
  assert.equal(result.status, 'needs_action');
  assert.equal(result.stateChangedAt, '2026-09-21');
  // Explicit manual commands stamp the transition even when contact mail shares its date.
  for (const [command, args, status] of [
    ['applied', [], 'applied'],
    ['skip', [], 'skipped'],
    ['outcome', ['--outcome', 'Rejected'], 'closed'],
    ['outcome', ['--outcome', 'Interview'], 'interviewing'],
  ]) {
    seed({ lastContactAt: '2026-09-21', emailEvents: [{ event: 'other', date: '2026-09-21' }] });
    const manual = spawnSync(process.execPath, ['scripts/job-board.mjs', command, '123', '--date', '2026-09-21', ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(manual.status, 0, manual.stderr);
    result = importMail([interview]);
    assert.equal(result.status, status);
    assert.equal(result.stateChangedAt, '2026-09-21');
    assert.equal(result.nextEventAt, '');
  }
  // Reasserting applied today must retain the original application date while
  // establishing a fresh manual transition boundary.
  seed({ appliedAt: '2026-09-01', stateChangedAt: '2026-09-18', lastContactAt: '2026-09-20',
    emailEvents: [{ event: 'other', date: '2026-09-20' }] });
  const todayBefore = new Date().toISOString().slice(0, 10);
  const reapplied = spawnSync(process.execPath, ['scripts/job-board.mjs', 'applied', '123'], { cwd: root, encoding: 'utf8' });
  const todayAfter = new Date().toISOString().slice(0, 10);
  assert.equal(reapplied.status, 0, reapplied.stderr);
  result = JSON.parse(readFileSync(metadata, 'utf8')).lifecycle;
  assert.ok([todayBefore, todayAfter].includes(result.stateChangedAt));
  const transitionDate = result.stateChangedAt;
  assert.equal(result.appliedAt, '2026-09-01');
  result = importMail([interview]);
  assert.equal(result.status, 'applied');
  assert.equal(result.appliedAt, '2026-09-01');
  assert.equal(result.stateChangedAt, transitionDate);
  assert.equal(result.nextEventAt, '');
  console.log('import history tests: PASS');
} finally { rmSync(root, { recursive: true, force: true }); }
