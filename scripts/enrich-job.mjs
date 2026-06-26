// Thin harness: detect ATS type from a job's applyUrl, output routing instructions.
//
// Usage:
//   node scripts/enrich-job.mjs <job-id>
//
// Output: JSON to stdout with { jobId, atsType, url, outputPath, title, company }
// The agent reads this, loads the skill `resume-os-enrich-<atsType>`, and follows it.
//
// This harness knows NOTHING about how to scrape any ATS.
// It just detects the type and routes. Skills do the rest.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { workDir } from "../engine/config.mjs";

const REPO_ROOT = resolve(process.cwd());
const jobId = process.argv[2];

if (!jobId) {
  console.error("Usage: node scripts/enrich-job.mjs <job-id>");
  process.exit(2);
}

const inboxDir = join(workDir(), "inbox", jobId);
const metadataPath = join(inboxDir, "metadata.json");

if (!existsSync(metadataPath)) {
  console.error(`No metadata.json found for job ${jobId}`);
  process.exit(1);
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));

// Prefer applyUrl (external ATS); fall back to LinkedIn URL
const url = metadata.applyUrl || metadata.url || "";

function detectATS(url) {
  if (!url) return "linkedin";
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes("ashbyhq.com"))           return "ashby";
    if (hostname.includes("greenhouse.io"))          return "greenhouse";
    if (hostname.includes("lever.co"))               return "lever";
    if (hostname.includes("myworkdayjobs.com"))      return "workday";
    if (hostname.includes("workday.com"))            return "workday";
    if (hostname.includes("successfactors"))         return "successfactors";
    if (hostname.includes("sapsf"))                  return "successfactors";
    if (hostname.includes("indeed.com"))             return "indeed";
    if (hostname.includes("linkedin.com"))           return "linkedin";
    return "generic";
  } catch {
    return "generic";
  }
}

const atsType = detectATS(url);

// If applyUrl is also LinkedIn (Easy Apply), use LinkedIn scraping
// If no applyUrl at all, fall back to LinkedIn
const effectiveUrl = url || metadata.url;
const effectiveAts = effectiveUrl === metadata.url && !metadata.applyUrl
  ? "linkedin"
  : atsType;

const outputPath = join(inboxDir, "enrichment.md");

// Check if already enriched
const alreadyEnriched = existsSync(outputPath);

console.log(JSON.stringify({
  jobId,
  atsType: effectiveAts,
  url: effectiveUrl,
  linkedinUrl: metadata.url,
  outputPath,
  title: metadata.title,
  company: metadata.company,
  alreadyEnriched,
}, null, 2));
