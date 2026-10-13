// Search LinkedIn jobs via Playwright CDP (connects to system Chrome).
// Chrome handles its own profile + cookies; Playwright just drives it.
//
// Usage:
//   node scripts/search-linkedin-jobs.mjs
//   node scripts/search-linkedin-jobs.mjs --dryrun
//   node scripts/search-linkedin-jobs.mjs --json
//   node scripts/search-linkedin-jobs.mjs --keywords "..." --location "..."
//   node scripts/search-linkedin-jobs.mjs --since "2026-08-13T18:28:00-04:00"
//
// Output: NDJSON to stdout. Each job includes its exact LinkedIn job ID.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { readLinkedInSearchCards } from "../engine/linkedin-search-cards.mjs";
import { readSelectedLinkedInDetail } from "../engine/linkedin-selected-detail.mjs";
import { assertLinkedInSession } from "../engine/linkedin-session.mjs";
import { clearDeadChromeLock } from "../engine/linkedin-profile-lock.mjs";
import { createServer } from "node:net";
import { resolveBrowserPath, loadProfile, workDir } from "../engine/config.mjs";
import { recordLinkedInCooldown, assertLinkedInCooldown } from "../engine/linkedin-cooldown.mjs";
import { acquireLinkedInLock } from "../engine/linkedin-lock.mjs";
import { isCompanyExcluded } from "../engine/job-exclusions.mjs";
import {
  buildLinkedInSearchUrl,
  dedupeSearchResults,
  resolveRecencySeconds,
} from "../engine/linkedin-discovery-query.mjs";

export async function main(args = process.argv.slice(2)) {
const PROFILE_DIR = join(homedir(), ".linkedin-chrome-profile");
const jobSearch = loadProfile().jobSearch || {};
const defaultTitles = jobSearch.titles?.length ? jobSearch.titles : ["product manager", "product owner"];
const defaultLocation = jobSearch.locations?.[0] || "Vancouver, British Columbia, Canada";
const opts = parseArgs(args, defaultLocation);
let recencySeconds;
try {
  recencySeconds = resolveRecencySeconds(opts.since);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

if (!existsSync(PROFILE_DIR)) {
  console.error("No LinkedIn Chrome profile. Run: node scripts/save-linkedin-cookies.mjs");
  process.exit(1);
}

// LinkedIn's OR search is unreliable — run two separate searches and merge
const keywords = opts.keywords ? [opts.keywords] : defaultTitles.map((t) => t.toLowerCase());
const allJobs = [];
const queries = [];

// Reuse one Chrome session for both searches
const sharedLock = acquireLinkedInLock("linkedin-discovery");
if (!sharedLock.acquired) {
  console.error(`skipped: lock held by ${sharedLock.holder?.workflow || "unknown"}`);
  process.exit(75);
}
const lockFile = join(PROFILE_DIR, "SingletonLock");
let chromeProc;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => { chromeProc?.kill("SIGTERM"); sharedLock.release(); process.exit(signal === "SIGTERM" ? 143 : 130); });
}
try {
  assertLinkedInCooldown({ work: workDir() });
  clearDeadChromeLock(lockFile);
  const port = await findFreePort();
  chromeProc = spawn(
    resolveBrowserPath(),
    [
      `--user-data-dir=${PROFILE_DIR}`,
      `--remote-debugging-port=${port}`,
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
      "--disable-blink-features=AutomationControlled", "--disable-features=TranslateUI",
      "--window-size=1920,1080", "about:blank",
    ],
    { stdio: "ignore" }
  );
  await sleep(10000);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];

  for (const kw of keywords) {
    const url = buildLinkedInSearchUrl(kw, opts.location, recencySeconds);
    if (!opts.dryrun) console.error(`Search [${kw}]: ${url}`);
    const prior = opts.cursor.find(item => item.keyword === kw && item.location === opts.location);
    if (prior?.complete) { queries.push(prior); continue; }
    const result = await searchPage(page, url, { startOffset: prior?.nextStart || 0, maxPages: opts.pages, previousPageIds: prior?.lastPageIds || '' });
    console.error(`  ${kw}: ${result.jobs.length} jobs (${result.coverage.reason})`);
    allJobs.push(...result.jobs);
    queries.push({ keyword: kw, location: opts.location, ...result.coverage });
  }

  await browser.close();
} finally {
  chromeProc?.kill("SIGTERM");
  sharedLock.release();
}


// Dedup across both searches
const unique = dedupeSearchResults(allJobs);

console.error(`Total: ${unique.length} unique jobs (from ${allJobs.length} raw).`);

// Title filter: must contain "product manager" or "product owner"
// Excludes: Director of Product, VP of Product, Product Designer, etc.
const titleFilter = /product\s*(manager|owner)/i;
const titleFiltered = unique.filter(j => titleFilter.test(j.title));

const skipped_titles = unique.length - titleFiltered.length;
if (skipped_titles > 0) {
  console.error(`Title filter: removed ${skipped_titles} non-PM/PO jobs:`);
  for (const j of unique) {
    if (!titleFilter.test(j.title)) {
      console.error(`  ✗ ${j.company} — ${j.title}`);
    }
  }
}

const filtered = titleFiltered.filter((job) => !isCompanyExcluded(job.company));
const skippedCompanies = titleFiltered.filter((job) => isCompanyExcluded(job.company));
if (skippedCompanies.length > 0) {
  console.error(`Company exclusion: removed ${skippedCompanies.length} job(s):`);
  for (const job of skippedCompanies) console.error(`  ✗ ${job.company} — ${job.title}`);
}

if (opts.dryrun) {
  console.error("Sample:");
  for (const j of filtered.slice(0, 5)) {
    console.error(`  ${j.company || "?"} — ${j.title || "?"}  (${j.postedTimeAgo || "?"})  ${j.url}`);
  }
  process.exit(0);
}

const output = filtered;
if (opts.coverageJson) {
  console.log(JSON.stringify({ jobs: output, coverage: { complete: queries.every(q => q.complete), queries } }, null, 2));
} else if (opts.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  for (const j of output) console.log(JSON.stringify(j));
}

}

// ── Core ──────────────────────────────────────────────────────────────────

// Completion needs an explicit paginator state, never a short virtualized card list.
export function readSearchPaginationEnd() {
  const visible = node => Boolean(node && node.getClientRects().length);
  const containers = [...document.querySelectorAll('.jobs-search-pagination,.artdeco-pagination,[data-test-pagination]')].filter(visible);
  for (const container of containers) {
    const next = [...container.querySelectorAll('button,a')].find(node => /^(?:next|next page|view next page)$/i.test((node.getAttribute('aria-label') || node.textContent || '').trim()));
    const disabled = next && (next.disabled === true || next.getAttribute('aria-disabled') === 'true');
    if (!disabled || !visible(next)) continue;
    const selected = container.querySelector('[aria-current="page"],.artdeco-pagination__indicator--number.active button,.artdeco-pagination__indicator--number.selected button');
    const numbers = [...container.querySelectorAll('button,a')].map(node => Number((node.textContent || '').trim())).filter(n => Number.isInteger(n) && n > 0);
    const current = Number((selected?.textContent || '').trim());
    if (!selected || (Number.isInteger(current) && current > 0 && numbers.length && current === Math.max(...numbers))) return true;
  }
  return false;
}

const rateObservers = new WeakMap();
function rateLimitGuard(page, { work, now }) {
  if (!rateObservers.has(page)) {
    let failure = null;
    const record = response => {
      try {
        if (response.status() !== 429 || !/(^|\.)linkedin\.com$/i.test(new URL(response.url()).hostname)) return;
        const ledger = recordLinkedInCooldown({ work, now: now(), retryAfter: response.headers?.()['retry-after'], workflow: 'linkedin-discovery' });
        failure = Object.assign(new Error(`LINKEDIN_RATE_LIMITED: cooldown until ${ledger.retryAt}`), { code: 'LINKEDIN_COOLDOWN', retryAt: ledger.retryAt });
      } catch (error) { failure = error; }
    };
    page.on('response', record);
    const assert = () => { if (failure) throw failure; assertLinkedInCooldown({ work, now: now() }); };
    assert.record = record;
    rateObservers.set(page, assert);
  }
  return rateObservers.get(page);
}

export function scrollSearchCards({ reset = false } = {}) {
  const card = document.querySelector('[componentkey^="job-card-component-ref-"],li[data-occludable-job-id],.job-card-container');
  const candidates = [];
  for (let node = card?.parentElement; node && node !== document.body; node = node.parentElement) {
    if (node.clientHeight > 0 && /auto|scroll/.test(getComputedStyle(node).overflowY)) candidates.push(node);
  }
  // Prefer a genuinely scrolling ancestor over a fitted inner list: the latter can
  // otherwise falsely certify seven mounted cards while its parent virtualizes 25.
  const node = candidates.find(node => node.scrollHeight > node.clientHeight + 2) || candidates.find(node => node.matches('.jobs-search-results-list,.scaffold-layout__list'));
  if (node) {
    if (reset) { node.scrollTop = 0; return { available: true }; }
    const atBottom = node.scrollTop + node.clientHeight >= node.scrollHeight - 2;
    const position = `${node.scrollTop}:${node.scrollHeight}:${node.clientHeight}`;
    if (!atBottom) node.scrollTop = Math.min(node.scrollHeight, node.scrollTop + Math.max(1, Math.floor(node.clientHeight / 2)));
    return { available: true, atBottom, position };
  }
  return { available: false };
}

export async function materializeSearchCards(page, assertActive, maxSteps = 40) {
  const found = new Map();
  await page.evaluate(scrollSearchCards, { reset: true });
  await page.waitForTimeout(300);
  let stable = 0, previous = '';
  for (let step = 0; step < maxSteps; step++) {
    assertActive();
    const mounted = await page.evaluate(readLinkedInSearchCards);
    for (const job of mounted) found.set(job.linkedinJobId, job);
    const scroll = await page.evaluate(scrollSearchCards, {});
    assertActive();
    const signature = `${scroll?.position}:${[...found.keys()].sort().join(',')}`;
    stable = scroll?.available && scroll.atBottom && signature === previous ? stable + 1 : 0;
    if (stable >= 2) return { jobs: [...found.values()], complete: true };
    if (!scroll?.available) return { jobs: [...found.values()], complete: false };
    previous = signature;
    await page.waitForTimeout(300);
  }
  return { jobs: [...found.values()], complete: false };
}

export async function searchPage(page, url, { startOffset = 0, maxPages = 4, previousPageIds = '', sessionCheck = assertLinkedInSession, work = workDir(), now = () => new Date() } = {}) {
  if (!Number.isSafeInteger(startOffset) || startOffset < 0 || startOffset % 25 || !Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error('Invalid search pagination options');
  const assertRateLimit = rateLimitGuard(page, { work, now });
  assertRateLimit();
  const allJobs = [];
  let start = startOffset;
  let lastPageIds = previousPageIds;
  for (let count = 0; count < maxPages; count++, start += 25) {
    try {
      assertRateLimit();
      const pageUrl = new URL(url);
      pageUrl.searchParams.set('start', String(start));
      const response = await page.goto(pageUrl.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      if (response?.status() === 429) { assertRateLimit.record(response); assertRateLimit(); }
      if (response?.status() >= 400) throw new Error(`LinkedIn search HTTP ${response.status()}`);
      await page.waitForTimeout(3000);
      await sessionCheck(page);
      await page.waitForFunction(() => document.querySelector('[componentkey^="job-card-component-ref-"], li[data-occludable-job-id], .job-card-container') || /No results found|No matching jobs/i.test(document.body.innerText), null, { timeout: 15000 });
      assertRateLimit();
      const materialized = await materializeSearchCards(page, assertRateLimit);
      const jobs = materialized.jobs;
      const explicitlyEmpty = !jobs.length && await page.evaluate(() => /No results found|No matching jobs/i.test(document.body.innerText));
      if (!jobs.length && !explicitlyEmpty) throw new Error('LinkedIn search loaded without recognizable cards or explicit empty results');
      assertRateLimit();
      if (!materialized.complete && !explicitlyEmpty) {
        for (const job of jobs) job.postedAt = parseTimeAgo(job.postedTimeAgo);
        allJobs.push(...jobs);
        return { jobs: allJobs, coverage: { complete: false, nextStart: start, lastPageIds, reason: 'page_error', error: 'Could not certify complete materialization of search cards' } };
      }
      const pageIds = jobs.map(job => job.linkedinJobId).sort().join(',');
      if (pageIds && pageIds === lastPageIds) {
        const ended = await page.evaluate(readSearchPaginationEnd);
        assertRateLimit();
        if (ended) return { jobs: allJobs, coverage: { complete: true, nextStart: null, reason: 'explicit_last_page' } };
        return { jobs: allJobs, coverage: { complete: false, nextStart: start, lastPageIds, reason: 'repeated_page' } };
      }
      const selectedIds = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/jobs/view/"]')]
        .filter(a => !a.closest('[componentkey^="job-card-component-ref-"],li[data-occludable-job-id],.job-card-container'))
        .map(a => a.href.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:\/|$)/)?.[1]).filter(Boolean))]);
      if (Array.isArray(selectedIds) && selectedIds.length === 1) {
        const selected = jobs.find(job => job.linkedinJobId === selectedIds[0]);
        if (selected) {
          const detail = await page.evaluate(readSelectedLinkedInDetail, selected);
          if (detail?.sourceEvidence?.linkedinJobId === selected.linkedinJobId && detail.sourceEvidence.titleAndCompanyMatched === true) Object.assign(selected, detail);
        }
      }
      for (const job of jobs) job.postedAt = parseTimeAgo(job.postedTimeAgo);
      allJobs.push(...jobs);
      lastPageIds = pageIds;
      assertRateLimit();
      const ended = jobs.length && await page.evaluate(readSearchPaginationEnd);
      assertRateLimit();
      if (ended) return { jobs: allJobs, coverage: { complete: true, nextStart: null, reason: 'explicit_last_page' } };
      // Short DOM card lists can be virtualization, not proof of the final page.
      assertRateLimit();
      if (explicitlyEmpty) return { jobs: allJobs, coverage: { complete: true, nextStart: null, reason: 'explicit_empty_page' } };
    } catch (error) {
      assertRateLimit();
      if (/LINKEDIN_(?:AUTH_REQUIRED|RATE_LIMITED):/.test(error.message)) throw error;
      return { jobs: allJobs, coverage: { complete: false, nextStart: start, lastPageIds, reason: 'page_error', error: error.message } };
    }
  }
  return { jobs: allJobs, coverage: { complete: false, nextStart: start, lastPageIds, reason: 'page_cap' } };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseTimeAgo(text) {
  if (!text) return null;
  const now = Date.now();
  if (/just now/i.test(text)) return now - 60_000;
  const m =
    text.match(/^(\d+)\s+(minute|hour|day|week|month)s?\s+ago$/i) ||
    text.match(/^(\d+)([dhm])\s+ago$/i);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  let unit = (m[2] || "").toLowerCase();
  if (unit === "d") unit = "day";
  if (unit === "h") unit = "hour";
  if (unit === "m") unit = "minute";
  const ms = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_592_000_000 }[unit];
  return ms ? now - num * ms : null;
}


function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function parseArgs(args, defaultLocation) {
  const p = {
    keywords: null,
    location: defaultLocation,
    max: 50,
    json: false,
    dryrun: false,
    since: null,
    coverageJson: false,
    cursor: [],
    pages: 4,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--keywords") p.keywords = args[++i] ?? p.keywords;
    else if (args[i] === "--location") p.location = args[++i] ?? p.location;
    else if (args[i] === "--max") p.max = parseInt(args[++i], 10) || 15;
    else if (args[i] === '--coverage-json') p.coverageJson = true;
    else if (args[i] === '--cursor-json') {
      p.cursor = JSON.parse(args[++i]);
      if (!Array.isArray(p.cursor) || p.cursor.some(q => typeof q.keyword !== 'string' || typeof q.complete !== 'boolean' || (!q.complete && (!Number.isSafeInteger(q.nextStart) || q.nextStart < 0 || q.nextStart % 25)))) throw new Error('Invalid pagination cursor');
    }
    else if (args[i] === '--pages') {
      p.pages = Number(args[++i]);
      if (!Number.isSafeInteger(p.pages) || p.pages < 1) throw new Error('Invalid page budget');
    }
    else if (args[i] === "--json") p.json = true;
    else if (args[i] === "--dryrun") p.dryrun = true;
    else if (args[i] === "--since") p.since = args[++i] ?? null;
  }
  return p;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
