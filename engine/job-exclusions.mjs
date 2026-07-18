import { loadProfile } from "./config.mjs";

export function normalizeCompanyName(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isCompanyExcluded(company, profile = loadProfile()) {
  const candidate = normalizeCompanyName(company);
  if (!candidate) return false;
  const excludedCompanies = profile.jobSearch?.excludedCompanies;
  if (!Array.isArray(excludedCompanies)) return false;
  return excludedCompanies
    .some((excluded) => normalizeCompanyName(excluded) === candidate);
}
