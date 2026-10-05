import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const fixture = mkdtempSync(join(tmpdir(), 'discovery-stop-'));
const work = join(fixture, 'work');
const calls = join(fixture, 'calls.jsonl');
const boundary = join(fixture, '.linkedin-last-checked');
const stop = join(work, 'linkedin-stop.json');
try {
  mkdirSync(join(fixture, 'scripts'));
  mkdirSync(join(fixture, 'engine'));
  mkdirSync(work);
  cpSync('scripts/run-linkedin-discovery.mjs', join(fixture, 'scripts/run-linkedin-discovery.mjs'));
  cpSync('engine/linkedin-discovery-boundary.mjs', join(fixture, 'engine/linkedin-discovery-boundary.mjs'));
  writeFileSync(join(fixture, 'engine/config.mjs'), `export const workDir = () => ${JSON.stringify(work)};`);
  writeFileSync(join(fixture, 'engine/models.json'), JSON.stringify({ steps: { discovery_enrich: { model: 'fixture' } } }));
  writeFileSync(boundary, '1000\n');
  const trace = `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(calls)}, JSON.stringify({script:process.argv[1], args:process.argv.slice(2)})+'\\n');\n`;
  function search(body) { writeFileSync(join(fixture, 'scripts/search-linkedin-jobs.mjs'), trace + body); }
  function processJob(body) { writeFileSync(join(fixture, 'scripts/process-job.mjs'), trace + body); }
  function run() {
    return spawnSync(process.execPath, ['scripts/run-linkedin-discovery.mjs'], { cwd: fixture, encoding: 'utf8' });
  }
  function traceCalls() { return existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; }
  function heartbeat() { return JSON.parse(readFileSync(join(work, 'heartbeats/linkedin-discovery.json'), 'utf8')); }
  function assertStopped(result) {
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(heartbeat().failureCategory, 'linkedin_stopped');
    assert.equal(readFileSync(boundary, 'utf8'), '1000\n');
    assert.ok(existsSync(stop));
  }

  // Existing stop means not even search is launched.
  writeFileSync(stop, '{}');
  search('throw new Error("search must not run");');
  assertStopped(run());
  assert.deepEqual(traceCalls(), []);
  rmSync(stop);

  // Challenge on the first detail aborts the remaining jobs, enrichment and render.
  search(`console.log(JSON.stringify(['123','456'].map(id=>({linkedinJobId:id,url:'https://www.linkedin.com/jobs/view/'+id+'/',postedAt:Date.now()}))));`);
  processJob('console.log(JSON.stringify({authChallenge:true,failureCategory:"auth_challenge"}));');
  assertStopped(run());
  assert.equal(traceCalls().length, 2);
  assert.ok(traceCalls()[1].args[0].includes('/123/'));
  const count = traceCalls().length;
  assertStopped(run());
  assert.equal(traceCalls().length, count, 'later scheduled attempts respect the persistent stop');
  rmSync(stop);
  rmSync(calls);

  // An exceptional detail challenge follows the same immediate-stop contract.
  processJob('console.error("LINKEDIN_AUTH_REQUIRED: detail fixture checkpoint"); process.exit(1);');
  assertStopped(run());
  assert.equal(traceCalls().length, 2);
  rmSync(stop);
  rmSync(calls);

  // Search checkpoints also persist the stop and preserve the boundary.
  search('console.error("LINKEDIN_AUTH_REQUIRED: fixture checkpoint"); process.exit(1);');
  assertStopped(run());
  assert.equal(traceCalls().length, 1);
  assertStopped(run());
  assert.equal(traceCalls().length, 1);

  // Manual verification/clear permits ordinary discovery again.
  rmSync(stop);
  search('console.log("[]");');
  writeFileSync(join(fixture, 'scripts/job-board.mjs'), trace);
  const resumed = run();
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(heartbeat().exitCode, 0);
  assert.ok(Number(readFileSync(boundary, 'utf8')) > 1000);
  console.log('scheduled discovery stop tests: PASS');
} finally { rmSync(fixture, { recursive: true, force: true }); }
