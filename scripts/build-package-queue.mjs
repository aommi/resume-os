// Thin manifest generator: list enriched jobs ready for package building.
//
// Usage:
//   node scripts/build-package-queue.mjs
//
// Output: writes package-queue.md (fixed name; date is recorded inside the file)
// with inbox IDs of all enriched, not-yet-packaged jobs in to_apply or
// package_ready status. Overwrites on each run so dated copies don't accumulate.
// Codex reads this file to know what to build.
//
// This script is pure routing — it knows nothing about resumes, fit, or ATS.

import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { workDir } from "../engine/config.mjs";

const REPO_ROOT = resolve(process.cwd());
const WORK = workDir();
const INBOX = join(WORK, "inbox");
const APPS = join(WORK, "applications");

// ── Noise filter: aggregators, recruiters, listing farms ──────────────
const NOISE_COMPANIES = new Set([
  "pms for hire", "jobright.ai", "jobgether", "rex.zone",
  "mvp ventures", "sage recruiting inc.", "swim recruiting",
  "yochana", "quantum world technologies inc.", "highbrow technology inc",
  "veripark", "dataannotation", "openloop",
]);

function isNoise(company) {
  return NOISE_COMPANIES.has(company.toLowerCase().trim());
}

// ── Fuzzy package detection ────────────────────────────────────────────

// Normalize a string for comparison: lowercase, expand abbreviations, strip punctuation
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/\bpm\b/g, "product manager")
    .replace(/\bpo\b/g, "product owner")
    .replace(/\bsr\b/g, "senior")
    .replace(/\bgtm\b/g, "go to market")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Check if a job already has a package in applications/
function hasExistingPackage(company, title) {
  if (!existsSync(APPS)) return false;

  const normCompany = normalize(company);
  const normTitle = normalize(title);

  for (const d of readdirSync(APPS, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dirName = d.name.toLowerCase();

    // Exact slug match
    const exactSlug = `${company} - ${title}`.toLowerCase().replace(/[/\\?%*:|"<>]/g, "");
    if (dirName === exactSlug) return true;

    // Fuzzy: normalize then check if directory contains both company and role words
    const normDir = normalize(d.name);
    const companyWords = normCompany.split(" ").filter(w => w.length > 2);
    const titleWords = normTitle.split(" ").filter(w => w.length > 2);

    const companyMatch = companyWords.every(w => normDir.includes(w));
    const titleOverlap = titleWords.filter(w => normDir.includes(w)).length;

    if (companyMatch && titleOverlap >= Math.min(2, titleWords.length)) return true;
  }

  return false;
}

// ── Build queue ────────────────────────────────────────────────────────

const queue = [];
for (const jobId of readdirSync(INBOX)) {
  const jobDir = join(INBOX, jobId);
  const metaPath = join(jobDir, "metadata.json");
  const enrichPath = join(jobDir, "enrichment.md");

  if (!existsSync(metaPath) || !existsSync(enrichPath)) continue;

  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  const status = meta?.lifecycle?.status || "";
  const company = meta?.company || "";
  const title = meta?.title || "";
  const enrichedAt = meta?.enrichedAt || "";

  // Only queue jobs that are enriched and not yet applied/closed
  if (!["to_apply", "package_ready"].includes(status)) continue;
  if (!enrichedAt) continue;

  // Skip noise
  if (isNoise(company)) continue;

  // Check if already packaged (fuzzy match)
  if (hasExistingPackage(company, title)) continue;

  // Check if packagePath already set
  const packagePath = meta?.lifecycle?.packagePath;
  if (packagePath && existsSync(packagePath)) continue;

  queue.push({ id: jobId, company, title, enrichedAt });
}

// Sort by enriched date (newest first), then company
queue.sort((a, b) => {
  if (a.enrichedAt !== b.enrichedAt) return b.enrichedAt.localeCompare(a.enrichedAt);
  return a.company.localeCompare(b.company);
});

// ── Write manifest ─────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
const filename = "package-queue.md";

let manifest = `# Package Queue — ${today}\n\n`;
manifest += `> Generated from inbox/*/enrichment.md. Jobs enriched and ready, not yet packaged. No aggregators/recruiters.\n`;
manifest += `> Tell Codex: "Build packages from ${filename}"\n\n`;

if (queue.length === 0) {
  manifest += `_(no jobs in queue)_\n`;
} else {
  for (const job of queue) {
    manifest += `- inbox/${job.id}  # ${job.company} — ${job.title}\n`;
  }
}

manifest += `\n---\n${queue.length} jobs | ${today}\n`;

const manifestPath = join(WORK, filename);
writeFileSync(manifestPath, manifest);

// Print summary
console.log(JSON.stringify({
  queued: queue.length,
  manifest: manifestPath,
  jobs: queue.map(j => j.id),
}));
