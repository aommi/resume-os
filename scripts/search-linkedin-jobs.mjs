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
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { readLinkedInSearchCards } from "../engine/linkedin-search-cards.mjs";
import { assertLinkedInSession } from "../engine/linkedin-session.mjs";
import { clearDeadChromeLock } from "../engine/linkedin-profile-lock.mjs";
import { createServer } from "node:net";
import { resolveBrowserPath, loadProfile } from "../engine/config.mjs";
import { acquireLinkedInLock } from "../engine/linkedin-lock.mjs";
import { isCompanyExcluded } from "../engine/job-exclusions.mjs";
import {
  buildLinkedInSearchUrl,
  dedupeSearchResults,
  resolveRecencySeconds,
} from "../engine/linkedin-discovery-query.mjs";

const PROFILE_DIR = join(homedir(), ".linkedin-chrome-profile");
const jobSearch = loadProfile().jobSearch || {};
const defaultTitles = jobSearch.titles?.length ? jobSearch.titles : ["product manager", "product owner"];
const defaultLocation = jobSearch.locations?.[0] || "Vancouver, British Columbia, Canada";
const opts = parseArgs(process.argv.slice(2));
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
    const jobs = await searchPage(page, url);
    console.error(`  ${kw}: ${jobs.length} jobs`);
    allJobs.push(...jobs);
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
if (opts.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  for (const j of output) console.log(JSON.stringify(j));
}

// ── Core ──────────────────────────────────────────────────────────────────

async function searchPage(page, url) {
  const allJobs = [];
  let start = 0;

  while (true) {
    const pageUrl = url.replace("start=0", `start=${start}`);
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3000);
    await assertLinkedInSession(page);
    await page.waitForFunction(() => document.querySelector('[componentkey^="job-card-component-ref-"], li[data-occludable-job-id], .job-card-container') || /No results found|No matching jobs/i.test(document.body.innerText), null, { timeout: 15000 });
    const jobs = await page.evaluate(readLinkedInSearchCards);
    if (!jobs.length && !await page.evaluate(() => /No results found|No matching jobs/i.test(document.body.innerText))) {
      throw new Error('LinkedIn search loaded without recognizable job cards or an explicit empty-results state');
    }

    // Compute postedAt on Node side
    for (const j of jobs) {
      j.postedAt = parseTimeAgo(j.postedTimeAgo);
    }

    allJobs.push(...jobs);

    // Stop if fewer than 20 results (last page) or we've done 4 pages
    if (jobs.length < 20 || start >= 75) break;
    start += 25;
  }

  return allJobs;
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

function parseArgs(args) {
  const p = {
    keywords: null,
    location: defaultLocation,
    max: 50,
    json: false,
    dryrun: false,
    since: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--keywords") p.keywords = args[++i] ?? p.keywords;
    else if (args[i] === "--location") p.location = args[++i] ?? p.location;
    else if (args[i] === "--max") p.max = parseInt(args[++i], 10) || 15;
    else if (args[i] === "--json") p.json = true;
    else if (args[i] === "--dryrun") p.dryrun = true;
    else if (args[i] === "--since") p.since = args[++i] ?? null;
  }
  return p;
}
