import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const profile = `import-history-test-${process.pid}`;
const root = join(process.cwd(), 'profiles', profile);
const work = join(root, 'work');
try {
  mkdirSync(join(work, 'inbox', '123'), { recursive: true });
  mkdirSync(join(work, 'events/pending'), { recursive: true });
  writeFileSync(join(root, 'profile.json'), JSON.stringify({ profileId: profile }));
  const metadata = join(work, 'inbox/123/metadata.json');
  writeFileSync(metadata, JSON.stringify({ company: 'Example', title: 'Product Manager', lifecycle: {
    status: 'interviewing', lastContactAt: '2026-09-20', appliedAt: '2026-09-02', emailEvents: [], outcome: 'Interview',
  } }));
  writeFileSync(join(work, 'events/pending/recovery.md'), '## JOB_EMAIL_EVENT\n- job_id: 123\n- company: Example\n- role: Product Manager\n- event: confirmation\n- event_date: 2026-09-03\n- message_id: imap:history-test\n- confidence: high\n- evidence: Application received\n');
  const run = spawnSync(process.execPath, ['scripts/import-events.mjs'], { env: { ...process.env, RESUME_OS_PROFILE: profile }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(readFileSync(metadata, 'utf8')).lifecycle;
  assert.equal(result.status, 'interviewing');
  assert.equal(result.lastContactAt, '2026-09-20');
  assert.equal(result.emailEvents.length, 1);
  console.log('import history tests: PASS');
} finally { rmSync(root, { recursive: true, force: true }); }
