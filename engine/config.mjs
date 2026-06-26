// Shared config + profile resolver for Resume OS tooling.
//
// Thin, deterministic, no judgment. Resolves machine/env config
// (resume-os.config.json) and the active profile (profiles/<id>/profile.json).
//
// Dual-path migration safety: every accessor falls back to the historical
// single-tenant value, so scripts keep working before resume-os.config.json or
// profiles/<id>/ exist. Once the config + profile are in place they take over
// with no behavior change.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

const ROOT = resolve(process.cwd());

const DEFAULTS = {
  activeProfile: "amirali",
  timezone: "America/Vancouver",
  browser: { path: null },
  variantTitles: {
    "": "Senior Product Manager",
    pm: "Product Manager",
    po: "Product Owner",
    "ai-workflow": "Senior Product Manager - AI Workflow",
    commerce: "Senior Product Manager - Commerce",
    "commerce-pm": "Product Manager - Commerce",
  },
};

// Neutral fallback used only when the active profile has no profile.json yet
// (a fresh/un-migrated profile). A configured profile always overrides this.
const FALLBACK_FULL_NAME = "Candidate";

let _cfg;

export function loadConfig() {
  if (_cfg) return _cfg;
  const path = join(ROOT, "resume-os.config.json");
  let raw = {};
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new Error(`Invalid resume-os.config.json: ${error.message}`);
    }
  }
  _cfg = {
    ...DEFAULTS,
    ...raw,
    browser: { ...DEFAULTS.browser, ...(raw.browser || {}) },
    variantTitles: { ...DEFAULTS.variantTitles, ...(raw.variantTitles || {}) },
  };
  return _cfg;
}

// Active profile directory. Dual-path: profiles/<id>/ once it exists, else the
// repo root (where single-tenant data still lives pre-P2).
export function activeProfileId(cfg = loadConfig()) {
  // RESUME_OS_PROFILE env overrides config (the lightweight "--profile" switch).
  return process.env.RESUME_OS_PROFILE || cfg.activeProfile || DEFAULTS.activeProfile;
}

export function profileDir(cfg = loadConfig()) {
  const dir = join(ROOT, "profiles", activeProfileId(cfg));
  return existsSync(dir) ? dir : ROOT;
}

function dirOrRoot(sub, cfg) {
  const dir = join(profileDir(cfg), sub);
  return existsSync(dir) ? dir : ROOT;
}

// Where this profile's generated/pipeline state lives (inbox, applications,
// events, resume-formats, jobs-tracker.md, package-queue.md). Dual-path:
// profiles/<id>/work once it exists, else the repo root (pre-migration).
export function workDir(cfg = loadConfig()) {
  return dirOrRoot("work", cfg);
}

// Where this profile's base resumes live (resume.md, resume-pm.md, ...).
export function baseResumesDir(cfg = loadConfig()) {
  return dirOrRoot("base-resumes", cfg);
}

// Where this profile's private source material lives (exhaustive-experience, skills-bank).
export function sourcesDir(cfg = loadConfig()) {
  return dirOrRoot("sources", cfg);
}

// Resolve a base-resume reference. A bare name (no slash) resolves against the
// profile's base-resumes dir when present there; an explicit path (slash or
// absolute) is returned unchanged so callers can still point anywhere.
export function resolveBase(name, cfg = loadConfig()) {
  if (!name || name.includes("/") || isAbsolute(name)) return name;
  const candidate = join(baseResumesDir(cfg), name);
  return existsSync(candidate) ? candidate : name;
}

export function loadProfile(cfg = loadConfig()) {
  const path = join(profileDir(cfg), "profile.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${path}: ${error.message}`);
  }
}

export function fullName(profile = loadProfile()) {
  return profile.fullName || FALLBACK_FULL_NAME;
}

export function timezone(cfg = loadConfig()) {
  return cfg.timezone || DEFAULTS.timezone;
}

export function variantTitles(cfg = loadConfig()) {
  return cfg.variantTitles;
}

// Chrome/Chromium executable: explicit config path → CHROME_PATH env → common
// per-platform locations. Fails loud if none found (was a hardcoded macOS path).
export function resolveBrowserPath(cfg = loadConfig()) {
  const candidates = [
    cfg.browser?.path,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      "No Chrome/Chromium found. Set browser.path in resume-os.config.json or the CHROME_PATH env var.",
    );
  }
  return found;
}

export const repoRoot = ROOT;
