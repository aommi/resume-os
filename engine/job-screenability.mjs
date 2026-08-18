import { isCompanyExcluded } from "./job-exclusions.mjs";
import { findExactJobDuplicate } from "./job-identity.mjs";

const UNAVAILABLE_STATUSES = new Set(["package_ready", "applied", "needs_action", "interviewing", "closed"]);

export function assessScreenability(job, jobs, profile) {
  const metadata = job.metadata || {};
  const lifecycle = job.lifecycle || metadata.lifecycle || {};
  if (isCompanyExcluded(metadata.company || "", profile)) return unavailable("company is excluded by the active profile");
  if (UNAVAILABLE_STATUSES.has(lifecycle.status)) return unavailable(`lifecycle is already ${lifecycle.status}`);
  const duplicate = findExactJobDuplicate(job, jobs);
  if (duplicate) return unavailable(`duplicate of ${duplicate.job.id} by ${duplicate.basis}`);
  if (!String(metadata.description || "").trim()) return incomplete("job description is missing");
  return { state: "ready", reason: "" };
}

function unavailable(reason) { return { state: "unavailable", reason }; }
function incomplete(reason) { return { state: "incomplete", reason }; }
