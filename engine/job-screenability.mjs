import { isCompanyExcluded } from "./job-exclusions.mjs";

const UNAVAILABLE_STATUSES = new Set(["package_ready", "applied", "needs_action", "interviewing", "closed"]);

export function assessScreenability(job, jobs, profile) {
  const metadata = job.metadata || {};
  const lifecycle = job.lifecycle || metadata.lifecycle || {};
  if (isCompanyExcluded(metadata.company || "", profile)) return unavailable("company is excluded by the active profile");
  if (UNAVAILABLE_STATUSES.has(lifecycle.status)) return unavailable(`lifecycle is already ${lifecycle.status}`);
  const duplicate = canonicalDuplicate(job, jobs);
  if (duplicate) return unavailable(`duplicate of ${duplicate.id} by canonical URL`);
  if (!String(metadata.description || "").trim()) return incomplete("job description is missing");
  return { state: "ready", reason: "" };
}

function canonicalDuplicate(job, jobs) {
  const url = canonicalUrl(job.metadata?.url);
  if (!url) return null;
  const matches = jobs.filter((candidate) => candidate.id !== job.id && canonicalUrl(candidate.metadata?.url) === url);
  if (!matches.length) return null;
  const canonical = [job, ...matches].sort(compareCanonical)[0];
  return canonical.id === job.id ? null : canonical;
}

function compareCanonical(a, b) {
  const freshness = jobFreshness(b).localeCompare(jobFreshness(a));
  return freshness || a.id.localeCompare(b.id);
}

function jobFreshness(job) {
  return String(job.metadata?.fetched || job.metadata?.postedAt || job.metadata?.enrichedAt || "");
}

function canonicalUrl(value) {
  try {
    const url = new URL(value || "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function unavailable(reason) { return { state: "unavailable", reason }; }
function incomplete(reason) { return { state: "incomplete", reason }; }
