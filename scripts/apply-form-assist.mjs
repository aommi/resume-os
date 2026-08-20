#!/usr/bin/env node
// Assist with filling an application form from a sanitized manifest.
//
// Thin harness boundary:
// - deterministic browser/form operations only
// - profile values come from profiles/<activeProfile>/profile.json
// - job-specific answers come from a profile-local manifest
// - form submission and mutating network requests are blocked
//
// Usage:
//   node scripts/apply-form-assist.mjs --manifest profiles/example/work/application-form-example.json --dry-run
//   node scripts/apply-form-assist.mjs --manifest profiles/<id>/work/<private-manifest>.json

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, loadProfile, resolveBrowserPath, workDir } from "../engine/config.mjs";

const DANGEROUS_CLICK_RE = /submit|send application|finish application|complete application|final submit/i;
const DEFAULT_HOLD_MINUTES = 120;
const READ_ONLY_HTTP_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

if (isMain()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.dryRun ? dryRun(options) : await run(options);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "incomplete") process.exitCode = 2;
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

export function buildAutofillPlan({ manifest, profile, work }) {
  if (!manifest?.url) throw new Error("manifest.url is required");
  assertHttpUrl(manifest.url, "manifest.url");
  if (!manifest.profileId) throw new Error("manifest.profileId is required");
  if (!profile?.profileId) throw new Error("active profile has no profileId");
  if (manifest.profileId !== profile.profileId) {
    throw new Error(`manifest profileId ${manifest.profileId} does not match active profile ${profile.profileId}`);
  }

  const profileValues = profileValueMap(profile);
  const fields = [];
  const unresolved = [];

  for (const field of manifest.fields || []) {
    const value = resolveFieldValue(field, profileValues);
    const required = field.required !== false;
    const present = hasValue(value);
    const selectBy = field.selectBy || "label";
    if (field.type === "select" && !["label", "value"].includes(selectBy)) {
      throw new Error(`${field.label || "select field"} has unsupported selectBy: ${selectBy}`);
    }
    const planned = {
      label: field.label || field.name || "field",
      selectors: arrayOf(field.selectors || field.selector),
      type: field.type || "text",
      selectBy,
      value,
      required,
      source: field.valueFrom || (Object.prototype.hasOwnProperty.call(field, "value") ? "manifest.value" : ""),
      skipReason: !present && !required ? "blank optional value" : "",
    };
    if (required && !present) unresolved.push(`${planned.label} missing value`);
    fields.push(planned);
  }

  const uploads = manifest.fileUploads || [];
  const packageDir = resolveApplicationPackage(manifest.applicationPackage, work, uploads.length > 0);
  const files = [];
  for (const upload of uploads) {
    const required = upload.required !== false;
    const rawPath = upload.path || upload.file || "";
    const file = rawPath ? resolveUploadPath(rawPath, packageDir, work) : "";
    const fileExists = Boolean(file && existsSync(file));
    const planned = {
      label: upload.label || "file upload",
      selectors: arrayOf(upload.selectors || upload.selector),
      path: file,
      required,
      skipReason: !fileExists && !required ? "missing optional file" : "",
    };
    if (required && !fileExists) unresolved.push(`${planned.label} missing file: ${file || "(blank)"}`);
    files.push(planned);
  }

  const clicks = (manifest.clickBeforeFill || []).map((click) => ({
    label: click.label || click.text || click.selector || "click",
    selector: click.selector || "",
    text: click.text || "",
    purpose: click.purpose || "open_form",
    required: click.required !== false,
  }));

  return {
    profileId: manifest.profileId,
    url: manifest.url,
    applicationPackage: packageDir,
    holdMinutes: normalizeHoldMinutes(manifest.holdMinutes ?? DEFAULT_HOLD_MINUTES),
    clicks,
    fields,
    fileUploads: files,
    unresolved,
  };
}

export function profileValueMap(profile = {}) {
  const contact = profile.contact || {};
  const [firstName, ...lastParts] = String(profile.fullName || "").trim().split(/\s+/).filter(Boolean);
  const links = Array.isArray(contact.links) ? contact.links : [];
  const link = (needle) => links.find((value) => String(value).toLowerCase().includes(needle)) || "";
  return {
    "profile.fullName": profile.fullName || "",
    "profile.firstName": firstName || "",
    "profile.lastName": lastParts.join(" "),
    "profile.email": contact.email || "",
    "profile.phone": contact.phone || "",
    "profile.addressLine1": contact.addressLine1 || "",
    "profile.city": contact.city || "",
    "profile.province": contact.province || "",
    "profile.postalCode": contact.postalCode || "",
    "profile.country": contact.country || "",
    "profile.resumeLocation": contact.resumeLocation || "",
    "profile.linkedin": link("linkedin"),
    "profile.github": link("github"),
    "ats.previouslyWorkedForCompany": profile.atsAnswers?.previouslyWorkedForCompany || "",
    "ats.applicationType": profile.atsAnswers?.applicationType || "",
    "ats.legallyAbleToWork": profile.atsAnswers?.legallyAbleToWork || "",
    "ats.willingBackgroundCheck": profile.atsAnswers?.willingBackgroundCheck || "",
    "ats.criminalOffenceNoPardon": profile.atsAnswers?.criminalOffenceNoPardon || "",
    "ats.accommodationsRequired": profile.atsAnswers?.accommodationsRequired || "",
    "ats.howDidYouHear": profile.atsAnswers?.howDidYouHear || "",
  };
}

export function parseArgs(args) {
  const parsed = { dryRun: false, headless: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--manifest") {
      parsed.manifest = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--manifest=")) {
      parsed.manifest = arg.slice("--manifest=".length);
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--headless") {
      parsed.headless = true;
    } else if (arg === "--hold-minutes") {
      parsed.holdMinutes = normalizeHoldMinutes(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--hold-minutes=")) {
      parsed.holdMinutes = normalizeHoldMinutes(arg.slice("--hold-minutes=".length));
    }
  }
  if (!parsed.manifest) throw new Error("--manifest <path> is required");
  return parsed;
}

function dryRun(runOptions) {
  const cfg = loadConfig();
  const work = workDir(cfg);
  const profile = loadProfile(cfg);
  const manifest = loadManifest(runOptions.manifest, work);
  const plan = buildAutofillPlan({ manifest, profile, work });
  if (runOptions.holdMinutes !== undefined) plan.holdMinutes = runOptions.holdMinutes;
  return { mode: "dry-run", status: plan.unresolved.length ? "incomplete" : "ready", plan };
}

async function run(runOptions) {
  const { chromium } = await import("playwright");
  const cfg = loadConfig();
  const work = workDir(cfg);
  const profile = loadProfile(cfg);
  const manifest = loadManifest(runOptions.manifest, work);
  const plan = buildAutofillPlan({ manifest, profile, work });
  if (runOptions.holdMinutes !== undefined) plan.holdMinutes = runOptions.holdMinutes;
  if (plan.unresolved.length) throw new Error(`manifest has unresolved required values: ${plan.unresolved.join("; ")}`);

  const browser = await chromium.launch({
    headless: Boolean(runOptions.headless),
    executablePath: resolveBrowserPath(cfg),
    args: ["--window-size=1440,1000"],
  });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const safety = { formSubmitsBlocked: 0, mutationRequestsBlocked: 0 };
  await installNoSubmitGuards(context, safety);
  const page = await context.newPage();
  const actions = [];

  await page.goto(plan.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2000);

  for (const click of plan.clicks) actions.push(await clickForOpenForm(page, click));
  for (const field of plan.fields) actions.push(await fillField(page, field));
  for (const upload of plan.fileUploads) actions.push(await uploadFile(page, upload));

  const { requiredErrors, status } = summarizeActions(actions);
  if (requiredErrors.length) {
    console.error(`Application assist incomplete. Required actions failed: ${requiredErrors.map((action) => action.label).join(", ")}. Holding for ${plan.holdMinutes} minutes for manual correction.`);
  } else {
    console.error(`Application assist complete. Submission remains blocked. Holding for ${plan.holdMinutes} minutes for manual review.`);
  }

  await new Promise((resolveHold) => setTimeout(resolveHold, plan.holdMinutes * 60 * 1000));
  await browser.close();

  return {
    mode: "browser",
    status,
    url: plan.url,
    actions,
    requiredErrors: requiredErrors.map((action) => action.label),
    formSubmitsBlocked: safety.formSubmitsBlocked,
    mutationRequestsBlocked: safety.mutationRequestsBlocked,
  };
}

export function summarizeActions(actions) {
  const requiredErrors = actions.filter((action) => action.status === "error");
  return { requiredErrors, status: requiredErrors.length ? "incomplete" : "complete" };
}

export async function installNoSubmitGuards(context, safety) {
  await context.exposeBinding("__resumeOsRecordBlockedSubmit", () => {
    safety.formSubmitsBlocked += 1;
  });
  await context.addInitScript(() => {
    const record = () => {
      try { globalThis.__resumeOsRecordBlockedSubmit?.(); } catch {}
    };
    document.addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      record();
    }, true);
    for (const method of ["submit", "requestSubmit"]) {
      Object.defineProperty(HTMLFormElement.prototype, method, {
        configurable: true,
        writable: true,
        value() { record(); },
      });
    }
  });
  await context.route("**/*", async (route) => {
    if (isReadOnlyHttpMethod(route.request().method())) await route.continue();
    else {
      safety.mutationRequestsBlocked += 1;
      await route.abort("blockedbyclient");
    }
  });
}

export function isReadOnlyHttpMethod(method) {
  return READ_ONLY_HTTP_METHODS.has(String(method || "").toUpperCase());
}

export async function clickForOpenForm(page, click) {
  if (click.purpose !== "open_form") return actionFailure(click, `unsupported click purpose: ${click.purpose}`);
  const locator = click.selector ? page.locator(click.selector).first() : page.getByText(click.text, { exact: false }).first();
  try {
    await locator.waitFor({ state: "visible", timeout: 5_000 });
    const control = await locator.evaluate((element) => ({
      tagName: element.tagName.toLowerCase(),
      type: "type" in element ? String(element.type || "").toLowerCase() : "",
      inForm: Boolean(element.closest("form")),
      formAction: "formAction" in element ? String(element.formAction || "") : "",
      href: "href" in element ? String(element.href || "") : "",
      text: String(element.textContent || ""),
      ariaLabel: String(element.getAttribute("aria-label") || ""),
      name: String(element.getAttribute("name") || ""),
      value: String(element.getAttribute("value") || ""),
      title: String(element.getAttribute("title") || ""),
    }));
    const policy = openFormControlPolicy(control, click);
    if (!policy.allowed) return actionFailure(click, policy.reason);
    await locator.click({ timeout: 5_000 });
    await page.waitForTimeout(1500);
    return ok(click.label, "clicked open_form");
  } catch (error) {
    return actionFailure(click, error.message);
  }
}

export function openFormControlPolicy(control, click = {}) {
  const signals = [
    control.text,
    control.ariaLabel,
    control.name,
    control.value,
    control.title,
    click.label,
    click.text,
    click.selector,
  ].filter(Boolean).join(" ");
  if (DANGEROUS_CLICK_RE.test(signals)) return { allowed: false, reason: "refused final-submit-like click" };
  if (control.formAction) return { allowed: false, reason: "refused control with form action" };
  if (control.inForm) return { allowed: false, reason: "refused control inside a form" };
  if (control.tagName === "a") {
    try {
      const protocol = new URL(control.href).protocol;
      if (["http:", "https:"].includes(protocol)) return { allowed: true, reason: "safe link" };
    } catch {}
    return { allowed: false, reason: "refused non-HTTP link" };
  }
  if (["button", "input"].includes(control.tagName) && control.type === "button") {
    return { allowed: true, reason: "safe non-submit button" };
  }
  return { allowed: false, reason: `refused unsupported control ${control.tagName || "unknown"}` };
}

export async function fillField(page, field) {
  if (field.skipReason) return skipped(field.label, field.skipReason);
  let lastError = "no selector matched";
  for (const selector of field.selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: 3_000 });
      if (field.type === "checkbox") {
        if (truthy(field.value)) await locator.check({ timeout: 3_000 });
        else await locator.uncheck({ timeout: 3_000 });
      } else if (field.type === "select") {
        await selectExactOption(locator, field.value, field.selectBy);
      } else {
        await locator.fill(String(field.value ?? ""), { timeout: 3_000 });
      }
      return ok(field.label, selector);
    } catch (error) {
      lastError = `${selector}: ${error.message}`;
    }
  }
  return actionFailure(field, lastError);
}

export async function uploadFile(page, upload) {
  if (upload.skipReason) return skipped(upload.label, upload.skipReason);
  let lastError = "no selector matched";
  for (const selector of upload.selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.setInputFiles(upload.path, { timeout: 3_000 });
      return ok(upload.label, selector);
    } catch (error) {
      lastError = `${selector}: ${error.message}`;
    }
  }
  return actionFailure(upload, lastError);
}

export async function selectExactOption(locator, expected, selectBy = "label") {
  const options = await locator.evaluate((element) => [...element.options].map((option, index) => ({
    index,
    label: String(option.textContent || ""),
    value: String(option.value || ""),
  })));
  const match = findExactOption(options, expected, selectBy);
  await locator.selectOption({ index: match.index });
}

export function findExactOption(options, expected, selectBy = "label") {
  if (!hasValue(expected)) throw new Error("cannot select an option from a blank value");
  if (!["label", "value"].includes(selectBy)) throw new Error(`unsupported selectBy: ${selectBy}`);
  const needle = normalizeOption(expected);
  const matches = options.filter((option) => normalizeOption(option[selectBy]) === needle);
  if (matches.length === 0) throw new Error(`no exact ${selectBy} match for ${expected}`);
  if (matches.length > 1) throw new Error(`ambiguous exact ${selectBy} match for ${expected}`);
  return matches[0];
}

export function loadManifest(path, work) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`manifest not found: ${path}`);
  assertRealContained(work, resolved, "manifest");
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`invalid manifest JSON ${path}: ${error.message}`);
  }
}

export function resolveApplicationPackage(value, work, required = true) {
  if (!value) {
    if (required) throw new Error("manifest.applicationPackage is required when fileUploads are present");
    return "";
  }
  if (isAbsolute(value)) throw new Error("manifest.applicationPackage must be relative to the active work directory");
  if (hasParentSegment(value)) throw new Error("manifest.applicationPackage must not contain parent traversal");
  const applicationsRoot = resolve(work, "applications");
  const packageDir = resolve(work, value);
  assertLexicalContained(applicationsRoot, packageDir, "application package", false);
  if (existsSync(packageDir)) assertRealContained(applicationsRoot, packageDir, "application package");
  return packageDir;
}

export function resolveUploadPath(value, packageDir, work) {
  if (!value) return "";
  if (!packageDir) throw new Error("manifest.applicationPackage is required for uploads");
  if (isAbsolute(value)) throw new Error("upload path must be relative to the application package");
  if (hasParentSegment(value)) throw new Error("upload path must not contain parent traversal");
  const applicationsRoot = resolve(work, "applications");
  const file = resolve(packageDir, value);
  assertLexicalContained(packageDir, file, "upload file", false);
  assertLexicalContained(applicationsRoot, file, "upload file", false);
  if (existsSync(file)) {
    assertRealContained(packageDir, file, "upload file");
    assertRealContained(applicationsRoot, file, "upload file");
  }
  return file;
}

function resolveFieldValue(field, profileValues) {
  if (field.valueFrom) {
    if (!Object.prototype.hasOwnProperty.call(profileValues, field.valueFrom)) {
      throw new Error(`${field.label || "field"} has unknown valueFrom key: ${field.valueFrom}`);
    }
    return profileValues[field.valueFrom];
  }
  if (Object.prototype.hasOwnProperty.call(field, "value")) return field.value;
  return "";
}

function assertLexicalContained(base, candidate, label, allowEqual = true) {
  const relation = relative(resolve(base), resolve(candidate));
  const outside = relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation);
  if (outside || (!allowEqual && !relation)) throw new Error(`${label} must stay inside ${base}`);
}

function assertRealContained(base, candidate, label) {
  const realBase = realpathSync(base);
  const realCandidate = realpathSync(candidate);
  assertLexicalContained(realBase, realCandidate, label);
}

function assertHttpUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be an HTTP(S) URL`); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`${label} must be an HTTP(S) URL`);
}

function normalizeHoldMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("hold minutes must be a non-negative number");
  return parsed;
}

function normalizeOption(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function hasParentSegment(value) {
  return String(value).split(/[\\/]+/).includes("..");
}

function hasValue(value) {
  return typeof value === "boolean" || (value !== null && value !== undefined && String(value).trim() !== "");
}

function arrayOf(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function ok(label, detail) { return { label, status: "ok", detail }; }
function skipped(label, detail) { return { label, status: "skipped", detail }; }
function failed(label, detail) { return { label, status: "error", detail }; }
function actionFailure(action, detail) { return action.required === false ? skipped(action.label, detail) : failed(action.label, detail); }
function truthy(value) { return [true, "true", "yes", "y", "1"].includes(typeof value === "string" ? value.toLowerCase() : value); }
function isMain() { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; }
