// Search LinkedIn jobs via Playwright CDP (connects to system Chrome).
// Chrome handles its own profile + cookies; Playwright just drives it.
//
// Usage:
//   node scripts/search-linkedin-jobs.mjs
//   node scripts/search-linkedin-jobs.mjs --dryrun
//   node scripts/search-linkedin-jobs.mjs --json
//   node scripts/search-linkedin-jobs.mjs --keywords "..." --location "..."
//
// Output: NDJSON to stdout. Each job: { url, title, company, location, postedAt, postedTimeAgo }

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { createServer } from "node:net";
import { resolveBrowserPath, loadProfile } from "../engine/config.mjs";

const PROFILE_DIR = join(homedir(), ".linkedin-chrome-profile");
const jobSearch = loadProfile().jobSearch || {};
const defaultTitles = jobSearch.titles?.length ? jobSearch.titles : ["product manager", "product owner"];
const defaultLocation = jobSearch.locations?.[0] || "Vancouver, British Columbia, Canada";
const opts = parseArgs(process.argv.slice(2));

if (!existsSync(PROFILE_DIR)) {
  console.error("No LinkedIn Chrome profile. Run: node scripts/save-linkedin-cookies.mjs");
  process.exit(1);
}

// LinkedIn's OR search is unreliable — run two separate searches and merge
const keywords = defaultTitles.map((t) => t.toLowerCase());
const allJobs = [];

// Reuse one Chrome session for both searches
const lockFile = join(PROFILE_DIR, "SingletonLock");
try { require("fs").unlinkSync(lockFile); } catch {}
const port = await findFreePort();

const chromeProc = spawn(
  resolveBrowserPath(),
  [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${port}`,
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
    "--disable-blink-features=AutomationControlled", "--disable-features=TranslateUI",
    "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "--window-size=1920,1080", "about:blank",
  ],
  { stdio: "ignore" }
);

await sleep(5000);

try {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];

  for (const kw of keywords) {
    const url = buildSearchUrl(kw, opts.location);
    if (!opts.dryrun) console.error(`Search [${kw}]: ${url}`);
    const jobs = await searchPage(page, url);
    console.error(`  ${kw}: ${jobs.length} jobs`);
    allJobs.push(...jobs);
  }

  await browser.close();
} finally {
  chromeProc.kill("SIGTERM");
  try { require("fs").unlinkSync(lockFile); } catch {}
}

if (allJobs.length === 0) {
  console.error("No job cards found. May need re-login: node scripts/save-linkedin-cookies.mjs");
  process.exit(1);
}

// Dedup across both searches
const seen = new Set();
const unique = allJobs.filter(j => {
  if (seen.has(j.url)) return false;
  seen.add(j.url);
  return true;
});

console.error(`Total: ${unique.length} unique jobs (from ${allJobs.length} raw).`);

// Title filter: must contain "product manager" or "product owner"
// Excludes: Director of Product, VP of Product, Product Designer, etc.
const titleFilter = /product\s*(manager|owner)/i;
const filtered = unique.filter(j => titleFilter.test(j.title));

const skipped_titles = unique.length - filtered.length;
if (skipped_titles > 0) {
  console.error(`Title filter: removed ${skipped_titles} non-PM/PO jobs:`);
  for (const j of unique) {
    if (!titleFilter.test(j.title)) {
      console.error(`  ✗ ${j.company} — ${j.title}`);
    }
  }
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

    const jobs = await page.evaluate(() => {
      const results = [];
      const seen = new Set();

      const links = document.querySelectorAll("a[href*='/jobs/view/']");
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const m = href.match(/\/jobs\/view\/(\d+)\//);
        if (!m) continue;
        const url = `https://www.linkedin.com/jobs/view/${m[1]}/`;
        if (seen.has(url)) continue;
        seen.add(url);

        const title = (link.textContent || "").trim();
        if (!title || title.length < 3) continue;

        const card =
          link.closest("li") ||
          link.closest('[data-job-id]') ||
          link.closest(".job-card-container") ||
          link.parentElement?.parentElement;

        let company = "";
        let location = "";
        let timeAgo = null;

        if (card) {
          const cardText = card.textContent || "";
          const timeMatch = cardText.match(
            /(\d+\s+(?:minute|hour|day|week|month)s?\s+ago|Just now|\d+[dhm]\s+ago)/i
          );
          if (timeMatch) timeAgo = timeMatch[1].trim();

          const lines = cardText.split("\n").map(l => l.trim()).filter(Boolean);
          const titleIdx = lines.findIndex(l => l.includes(title.slice(0, 15)));
          if (titleIdx >= 0 && lines.length > titleIdx + 1) {
            company = lines[titleIdx + 1] || "";
            if (lines.length > titleIdx + 2) location = lines[titleIdx + 2] || "";
          }
        }

        results.push({ url, title, company, location, postedTimeAgo: timeAgo });
      }
      return results;
    });

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

function buildSearchUrl(keywords, location) {
  return (
    "https://www.linkedin.com/jobs/search/?" +
    new URLSearchParams({
      keywords,
      location,
      f_TPR: "r86400",
      sortBy: "DD",
      start: "0",
    }).toString()
  );
}

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
    keywords: defaultTitles.map((t) => `"${t}"`).join(" OR "),
    location: defaultLocation,
    max: 50,
    json: false,
    dryrun: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--keywords") p.keywords = args[++i] ?? p.keywords;
    else if (args[i] === "--location") p.location = args[++i] ?? p.location;
    else if (args[i] === "--max") p.max = parseInt(args[++i], 10) || 15;
    else if (args[i] === "--json") p.json = true;
    else if (args[i] === "--dryrun") p.dryrun = true;
  }
  return p;
}
