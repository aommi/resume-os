const LINKEDIN_HOST = /(^|\.)linkedin\.com$/i;

export function extractLinkedInJobId(value) {
  const url = parseUrl(value);
  if (!url || !LINKEDIN_HOST.test(url.hostname)) return "";

  for (const key of ["currentJobId", "jobId"]) {
    const id = normalizeId(url.searchParams.get(key));
    if (id && /^\d+$/.test(id)) return id;
  }

  const pathMatch = url.pathname.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:\/|$)/i);
  return pathMatch?.[1] || "";
}

export function extractEmployerRequisition(value) {
  const url = unwrapLinkedInSafetyUrl(parseUrl(value));
  if (!url || LINKEDIN_HOST.test(url.hostname)) return emptyEmployerIdentity();

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const source = requisitionSource(url, host);
  const queryId = firstQueryValue(url, [
    "gh_jid",
    "requisitionId",
    "requisition_id",
    "reqId",
    "req_id",
    "jobId",
    "job_id",
    "opportunityId",
  ]);
  if (queryId) return employerIdentity(queryId, source);

  const path = decodeURIComponent(url.pathname);
  let match;

  if (/greenhouse\.io$|grnh\.se$/i.test(host)) {
    match = path.match(/\/jobs\/(\d+)(?:\/|$)/i);
  } else if (/myworkdayjobs\.com$/i.test(host)) {
    match = path.match(/_([^/_]+)\/?$/);
  } else if (/amazon\.jobs$/i.test(host)) {
    match = path.match(/\/jobs\/(\d+)(?:\/|$)/i);
  } else if (/ongig\.com$/i.test(host)) {
    match = path.match(/\/(\d{5,})(?:\/|$)/);
  } else if (/icims\.com$/i.test(host)) {
    match = path.match(/\/jobs\/(\d+)(?:\/|$)/i);
  } else if (/smartrecruiters\.com$/i.test(host)) {
    match = path.match(/\/[^/]+\/([^/]+?)(?:-[^/]*)?\/?$/);
  } else if (/ashbyhq\.com$|lever\.co$|rippling\.com$|bamboohr\.com$|workable\.com$/i.test(host)) {
    match = path.match(/\/([a-z0-9][a-z0-9-]{5,})\/?$/i);
  }

  return match?.[1] ? employerIdentity(match[1], source) : emptyEmployerIdentity();
}

export function resolveJobIdentity(metadata = {}) {
  const linkedinJobId = normalizeId(metadata.linkedinJobId) || extractLinkedInJobId(metadata.url);
  const derivedEmployer = extractEmployerRequisition(metadata.applyUrl || metadata.url || "");
  const employerRequisitionId = normalizeId(metadata.employerRequisitionId) || derivedEmployer.employerRequisitionId;
  const employerRequisitionSource = normalizeSource(metadata.employerRequisitionSource) ||
    derivedEmployer.employerRequisitionSource ||
    (employerRequisitionId && metadata.company ? `company:${normalizeCompany(metadata.company)}` : "");

  return { linkedinJobId, employerRequisitionId, employerRequisitionSource };
}

export function findExactJobDuplicate(job, jobs, { preferExisting = false } = {}) {
  const identity = resolveJobIdentity(job.metadata || job);
  const candidates = jobs.filter((candidate) => candidate.id !== job.id);
  if (identity.linkedinJobId) {
    const matches = candidates.filter((candidate) =>
      idsEqual(resolveJobIdentity(candidate.metadata).linkedinJobId, identity.linkedinJobId));
    if (matches.length) return duplicateResult(job, matches, "LinkedIn job ID", identity.linkedinJobId, preferExisting);
  }

  if (identity.employerRequisitionId && identity.employerRequisitionSource) {
    const matches = candidates.filter((candidate) => {
      const other = resolveJobIdentity(candidate.metadata);
      return idsEqual(other.employerRequisitionId, identity.employerRequisitionId) &&
        normalizeSource(other.employerRequisitionSource) === normalizeSource(identity.employerRequisitionSource);
    });
    if (matches.length) {
      return duplicateResult(job, matches, "employer requisition ID", identity.employerRequisitionId, preferExisting);
    }
  }

  const canonical = canonicalUrl(job.metadata?.url || job.url);
  if (canonical) {
    const matches = candidates.filter((candidate) => canonicalUrl(candidate.metadata?.url) === canonical);
    if (matches.length) return duplicateResult(job, matches, "canonical URL", canonical, preferExisting);
  }

  return null;
}

function duplicateResult(job, matches, basis, value, preferExisting) {
  if (preferExisting) return { job: [...matches].sort(compareCanonical)[0], basis, value };
  const appliedMatch = matches.filter(hasApplicationEvidence).sort(compareCanonical)[0];
  if (appliedMatch) return { job: appliedMatch, basis, value };
  const canonical = [job, ...matches].sort(compareCanonical)[0];
  return canonical.id === job.id ? null : { job: canonical, basis, value };
}

function compareCanonical(a, b) {
  const applied = Number(hasApplicationEvidence(b)) - Number(hasApplicationEvidence(a));
  if (applied) return applied;
  const freshness = jobFreshness(b).localeCompare(jobFreshness(a));
  return freshness || String(a.id).localeCompare(String(b.id));
}

function hasApplicationEvidence(job) {
  const lifecycle = job.lifecycle || job.metadata?.lifecycle || {};
  return Boolean(lifecycle.appliedAt) || ["applied", "needs_action", "interviewing"].includes(lifecycle.status);
}

function jobFreshness(job) {
  return String(job.metadata?.fetched || job.metadata?.postedAt || job.metadata?.enrichedAt || "");
}

function requisitionSource(url, host) {
  const segments = url.pathname.split("/").filter(Boolean);
  if (/greenhouse\.io$/i.test(host)) {
    const jobsIndex = segments.findIndex((segment) => segment.toLowerCase() === "jobs");
    const tenant = jobsIndex > 0 ? segments[jobsIndex - 1] : segments[0];
    return tenant ? `greenhouse:${tenant.toLowerCase()}` : "greenhouse";
  }
  if (/grnh\.se$/i.test(host)) return "greenhouse-shortlink";
  if (/myworkdayjobs\.com$/i.test(host)) return `workday:${host.split(".")[0].split("-")[0]}`;
  if (/ashbyhq\.com$/i.test(host)) return `ashby:${segments[0] || host}`.toLowerCase();
  if (/lever\.co$/i.test(host)) return `lever:${segments[0] || host}`.toLowerCase();
  if (/ongig\.com$/i.test(host)) return `ongig:${host.split(".")[0]}`;
  return `ats:${host}`;
}

function unwrapLinkedInSafetyUrl(url) {
  if (!url || !LINKEDIN_HOST.test(url.hostname) || !/\/safety\/go\/?$/i.test(url.pathname)) return url;
  return parseUrl(url.searchParams.get("url"));
}

function firstQueryValue(url, keys) {
  for (const key of keys) {
    const value = normalizeId(url.searchParams.get(key));
    if (value) return value;
  }
  return "";
}

function employerIdentity(employerRequisitionId, employerRequisitionSource) {
  return {
    employerRequisitionId: normalizeId(employerRequisitionId),
    employerRequisitionSource: normalizeSource(employerRequisitionSource),
  };
}

function emptyEmployerIdentity() {
  return { employerRequisitionId: "", employerRequisitionSource: "" };
}

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeSource(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCompany(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function idsEqual(a, b) {
  return normalizeId(a).toLowerCase() === normalizeId(b).toLowerCase();
}

function canonicalUrl(value) {
  const url = parseUrl(value);
  if (!url) return "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}
