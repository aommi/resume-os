#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { collectJobs } from './run-linkedin-discovery.mjs';
import { searchPage, readSearchPaginationEnd } from './search-linkedin-jobs.mjs';
const root = mkdtempSync(join(tmpdir(), 'linkedin-coverage-'));
let time = new Date('2026-10-13T12:00:00Z');
const work = join(root, 'work'), now = () => time;
const boundary = join(work, 'runtime/linkedin-collection-watermark');
const cursorPath = join(work, 'runtime/linkedin-collection-cursor.json');
const job = (id, postedAt = null) => ({ linkedinJobId: id, url: `https://www.linkedin.com/jobs/view/${id}/`, postedAt });
function pageFixture(pages, failureAt = -1) {
  let offset, calls = [];
  return { calls, on() {},
    async goto(url) { offset = Number(new URL(url).searchParams.get('start')); calls.push(offset); if (offset === failureAt) throw new Error('network interrupted'); return { status: () => 200 }; },
    async waitForTimeout() {}, async waitForFunction() {},
    async evaluate(fn) { if (fn.name === 'scrollSearchCards') return { available: true, atBottom: true, position: '0:100:100' }; if (fn.name === 'readSearchPaginationEnd') return false; return fn.name === 'readLinkedInSearchCards' ? structuredClone(pages[offset] || []) : !(pages[offset]?.length); },
  };
}
try {
  const searchSource = readFileSync(join(dirname(new URL(import.meta.url).pathname), 'search-linkedin-jobs.mjs'), 'utf8');
  assert.ok(searchSource.lastIndexOf('await main();') > searchSource.indexOf('const rateObservers = new WeakMap();'), 'CLI main must run after module-scope dependencies initialize');
  mkdirSync(join(work, 'runtime'), { recursive: true });
  const old = time.getTime() - 5 * 86400000;
  writeFileSync(boundary, String(old));
  const first = collectJobs({ work, now, search: request => {
    assert.equal(Date.parse(request.since), old - 86400000);
    return { jobs: [job('1'), job('2', old - 1000)], coverage: { complete: false, queries: [{ keyword: 'engineer', complete: false, nextStart: 100, reason: 'page_cap' }] } };
  } });
  assert.equal(first.exitCode, 0); assert.equal(first.report.undated, 1);
  assert.equal(first.report.added.length, 2); assert.equal(Number(readFileSync(boundary)), old);
  const cycleStarted = time.getTime();
  time = new Date(time.getTime() + 86400000);
  const second = collectJobs({ work, now, search: request => {
    assert.equal(request.cursor[0].nextStart, 100); assert.equal(Date.parse(request.since), old - 86400000);
    return { jobs: [job('3')], coverage: { complete: true, queries: [{ keyword: 'engineer', complete: true, nextStart: null, reason: 'explicit_empty_page' }] } };
  } });
  assert.equal(second.report.checkpointAdvanced, true); assert.equal(Number(readFileSync(boundary)), cycleStarted);
  assert.equal(existsSync(cursorPath), false);
  const legacy = collectJobs({ work, now, search: () => [job('4')] });
  assert.equal(legacy.report.checkpointAdvanced, false); assert.equal(legacy.report.added.length, 1);
  assert.equal(Number(readFileSync(boundary)), cycleStarted);
  const page = pageFixture({ 0: [job('5')], 25: [job('6')] });
  const capped = await searchPage(page, 'https://www.linkedin.com/jobs/search/?start=0', { maxPages: 2, work: join(root, 'search'), sessionCheck: async () => {} });
  assert.equal(capped.coverage.complete, false); assert.equal(capped.coverage.nextStart, 50);
  assert.deepEqual(page.calls, [0, 25]); // A short virtualized card list is not coverage.
  const resumed = await searchPage(page, 'https://www.linkedin.com/jobs/search/?start=0', { startOffset: 50, work: join(root, 'search'), sessionCheck: async () => {} });
  assert.equal(resumed.coverage.complete, true);
  const partial = await searchPage(pageFixture({ 0: [job('7')] }, 25), 'https://www.linkedin.com/jobs/search/', { work: join(root, 'search'), sessionCheck: async () => {} });
  assert.equal(partial.jobs.length, 1); assert.equal(partial.coverage.nextStart, 25); assert.equal(partial.coverage.reason, 'page_error');
  const repeat = await searchPage(pageFixture({ 0: [job('8')], 25: [job('8')] }), 'https://www.linkedin.com/jobs/search/', { work: join(root, 'search'), sessionCheck: async () => {} });
  assert.equal(repeat.coverage.complete, false); assert.equal(repeat.coverage.reason, 'repeated_page');
  time = new Date(time.getTime() + 1000);
  const stalled = collectJobs({ work, now, search: () => ({ jobs: [job('9')], coverage: { complete: false, queries: [{ keyword: 'engineer', complete: false, nextStart: 25, reason: 'page_error' }] } }) });
  assert.equal(stalled.exitCode, 1); assert.equal(stalled.report.added.length, 1);
  assert.equal(JSON.parse(readFileSync(join(work, 'heartbeats/linkedin-discovery.json'))).failureCategory, 'coverage_incomplete');
  assert.equal(Number(readFileSync(boundary)), cycleStarted);
  const visible = () => [1];
  let disabled = true, selectedNumber = '2';
  const next = { getClientRects: visible, get disabled() { return disabled; }, getAttribute: name => name === 'aria-label' ? 'Next' : null, textContent: '' };
  const numbers = ['1', '2'].map(textContent => ({ textContent, getAttribute: () => null }));
  const container = { getClientRects: visible, querySelectorAll: () => [...numbers, next], querySelector: () => ({ textContent: selectedNumber }) };
  globalThis.document = { querySelectorAll: () => [container] };
  assert.equal(readSearchPaginationEnd(), true);
  disabled = false; assert.equal(readSearchPaginationEnd(), false);
  disabled = true; selectedNumber = '1'; assert.equal(readSearchPaginationEnd(), false);
  delete globalThis.document;
  const terminalPage = pageFixture({ 0: [job('10')] });
  const evaluate = terminalPage.evaluate;
  terminalPage.evaluate = fn => fn.name === 'readSearchPaginationEnd' ? true : evaluate(fn);
  const ended = await searchPage(terminalPage, 'https://www.linkedin.com/jobs/search/', { work: join(root, 'search'), sessionCheck: async () => {} });
  assert.equal(ended.coverage.reason, 'explicit_last_page'); assert.equal(ended.coverage.complete, true);
  // A moving seven-card window must yield all 25 identities before pagination.
  const virtual = pageFixture({});
  let mountedStart = 0;
  const virtualEvaluate = virtual.evaluate;
  virtual.evaluate = async (fn, args) => {
    if (fn.name === 'scrollSearchCards') {
      if (args?.reset) { mountedStart = 0; return { available: true }; }
      const position = mountedStart;
      const atBottom = mountedStart >= 18;
      if (!atBottom) mountedStart = Math.min(18, mountedStart + 4);
      return { available: true, atBottom, position: String(position) };
    }
    if (fn.name === 'readLinkedInSearchCards') return Array.from({ length: 7 }, (_, i) => job(String(100 + mountedStart + i)));
    if (fn.name === 'readSearchPaginationEnd') return true;
    return virtualEvaluate(fn);
  };
  const virtualResult = await searchPage(virtual, 'https://www.linkedin.com/jobs/search/', { work: join(root, 'search'), sessionCheck: async () => {} });
  assert.equal(virtualResult.jobs.length, 25); assert.equal(virtualResult.coverage.complete, true);
  const uncertain = pageFixture({ 0: [job('200')] });
  const uncertainEvaluate = uncertain.evaluate;
  uncertain.evaluate = (fn, args) => fn.name === 'scrollSearchCards' ? { available: false } : fn.name === 'readSearchPaginationEnd' ? true : uncertainEvaluate(fn, args);
  const unknown = await searchPage(uncertain, 'https://www.linkedin.com/jobs/search/', { work: join(root, 'search'), sessionCheck: async () => {} });
  assert.equal(unknown.jobs.length, 1); assert.equal(unknown.coverage.complete, false); assert.equal(unknown.coverage.nextStart, 0);
  for (const timeout of [false, true]) {
    const limited = pageFixture({ 0: [job('300')] });
    let responseListener;
    limited.on = (event, callback) => { if (event === 'response') responseListener = callback; };
    limited.waitForTimeout = async () => {
      responseListener({ status: () => 429, url: () => 'https://www.linkedin.com/voyager/api/jobs' });
      if (timeout) throw new Error('Page timeout');
    };
    await assert.rejects(searchPage(limited, 'https://www.linkedin.com/jobs/search/', { work: join(root, `limited-${timeout}`), sessionCheck: async () => {} }), /LINKEDIN_RATE_LIMITED/);
    await assert.rejects(searchPage(limited, 'https://www.linkedin.com/jobs/search/?keywords=next', { work: join(root, `limited-${timeout}`), sessionCheck: async () => {} }), /LINKEDIN_RATE_LIMITED/);
    assert.equal(limited.calls.length, 1); // Sticky stop prevents a subsequent keyword request.
  }
  console.log('collection coverage: catch-up overlap, undated retention, persistent cursor, conservative checkpoint, page cap and partial traversal PASS');
} finally { rmSync(root, { recursive: true, force: true }); }
