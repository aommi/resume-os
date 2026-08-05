#!/usr/bin/env node
// Assist with filling an application form from a sanitized manifest.
//
// Thin harness boundary:
// - deterministic browser/form operations only
// - profile values come from profiles/<activeProfile>/profile.json
// - job-specific answers come from a profile-local or example manifest
// - never submits the application; leaves the browser open for human review
//
// Usage:
//   node scripts/apply-form-assist.mjs --manifest profiles/example/work/application-form-example.json --dry-run
//   node scripts/apply-form-assist.mjs --manifest profiles/<id>/work/<private-manifest>.json

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, loadProfile, resolveBrowserPath, workDir } from "../engine/config.mjs";

const DANGEROUS_CLICK_RE = /submit|send application|finish application|complete application|final submit/i;
const DEFAULT_HOLD_MINUTES = 120;

if (isMain()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = options.dryRun ? dryRun(options) : await run(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  }
}

export function buildAutofillPlan({ manifest, profile, work }) {
  if (!manifest?.url) throw new Error("manifest.url is required");
  const profileValues = profileValueMap(profile);
  const fields = [];
  const unresolved = [];

  for (const field of manifest.fields || []) {
    const value = resolveFieldValue(field, profileValues);
    const planned = {
      label: field.label || field.name || "field",
      selectors: arrayOf(field.selectors || field.selector),
      type: field.type || "text",
      value,
      required: field.required !== false,
      source: field.valueFrom || (Object.prototype.hasOwnProperty.call(field, "value") ? "manifest.value" : ""),
    };
    if (planned.required && !String(value || "").trim()) unresolved.push(planned.label);
    fields.push(planned);
  }

  const files = [];
  for (const upload of manifest.fileUploads || []) {
    const file = resolveManifestPath(upload.path || upload.file || "", work);
    const planned = {
      label: upload.label || "file upload",
      selectors: arrayOf(upload.selectors || upload.selector),
      path: file,
      required: upload.required !== false,
    };
    if (planned.required && (!file || !existsSync(file))) unresolved.push(`${planned.label} missing file: ${file || "(blank)"}`);
    files.push(planned);
  }

  const clicks = (manifest.clickBeforeFill || []).map((click) => ({
    label: click.label || click.text || click.selector || "click",
    selector: click.selector || "",
    text: click.text || "",
    purpose: click.purpose || "open_form",
  }));

  return {
    url: manifest.url,
    holdMinutes: Number(manifest.holdMinutes || DEFAULT_HOLD_MINUTES),
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
      parsed.holdMinutes = Number(args[index + 1]);
      index += 1;
    } else if (arg.startsWith("--hold-minutes=")) {
      parsed.holdMinutes = Number(arg.slice("--hold-minutes=".length));
    }
  }
  if (!parsed.manifest) throw new Error("--manifest <path> is required");
  return parsed;
}

function dryRun(runOptions) {
  const cfg = loadConfig();
  const work = workDir(cfg);
  const manifest = loadManifest(runOptions.manifest);
  const plan = buildAutofillPlan({ manifest, profile: loadProfile(cfg), work });
  if (runOptions.holdMinutes) plan.holdMinutes = runOptions.holdMinutes;
  return { mode: "dry-run", plan };
}

async function run(runOptions) {
  const { chromium } = await import("playwright");
  const cfg = loadConfig();
  const work = workDir(cfg);
  const manifest = loadManifest(runOptions.manifest);
  const plan = buildAutofillPlan({ manifest, profile: loadProfile(cfg), work });
  if (runOptions.holdMinutes) plan.holdMinutes = runOptions.holdMinutes;
  if (plan.unresolved.length) throw new Error(`manifest has unresolved required values: ${plan.unresolved.join("; ")}`);

  const browser = await chromium.launch({
    headless: Boolean(runOptions.headless),
    executablePath: resolveBrowserPath(cfg),
    args: ["--window-size=1440,1000"],
  });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
  const page = await context.newPage();
  const actions = [];

  await page.goto(plan.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2000);

  for (const click of plan.clicks) {
    actions.push(await clickForOpenForm(page, click));
  }

  for (const field of plan.fields) {
    actions.push(await fillField(page, field));
  }

  for (const upload of plan.fileUploads) {
    actions.push(await uploadFile(page, upload));
  }

  console.error(`Application assist complete. Review the browser manually; this script will never submit. Holding for ${plan.holdMinutes} minutes.`);
  await new Promise((resolveHold) => setTimeout(resolveHold, plan.holdMinutes * 60 * 1000));
  await browser.close();

  return { mode: "browser", url: plan.url, actions, submitted: false };
}

async function clickForOpenForm(page, click) {
  if (click.purpose !== "open_form") return skipped(click.label, `unsupported click purpose: ${click.purpose}`);
  const locator = click.selector ? page.locator(click.selector).first() : page.getByText(click.text, { exact: false }).first();
  try {
    await locator.waitFor({ state: "visible", timeout: 5_000 });
    const text = await locator.textContent({ timeout: 1_000 }).catch(() => "");
    if (DANGEROUS_CLICK_RE.test(text || click.label || click.text || "")) return skipped(click.label, "refused final-submit-like click");
    await locator.click({ timeout: 5_000 });
    await page.waitForTimeout(1500);
    return ok(click.label, "clicked open_form");
  } catch (error) {
    return skipped(click.label, error.message);
  }
}

async function fillField(page, field) {
  for (const selector of field.selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.waitFor({ state: "visible", timeout: 3_000 });
      if (field.type === "checkbox") {
        if (truthy(field.value)) await locator.check({ timeout: 3_000 });
        else await locator.uncheck({ timeout: 3_000 });
      } else if (field.type === "select") {
        await selectByVisibleText(locator, field.value);
      } else {
        await locator.fill(String(field.value || ""), { timeout: 3_000 });
      }
      return ok(field.label, selector);
    } catch {}
  }
  return skipped(field.label, `no selector matched: ${field.selectors.join(", ")}`);
}

async function uploadFile(page, upload) {
  for (const selector of upload.selectors) {
    try {
      const locator = page.locator(selector).first();
      await locator.setInputFiles(upload.path, { timeout: 3_000 });
      return ok(upload.label, selector);
    } catch {}
  }
  return skipped(upload.label, `no selector matched: ${upload.selectors.join(", ")}`);
}

async function selectByVisibleText(locator, contains) {
  const value = await locator.evaluate((el, text) => {
    const needle = String(text || "").toLowerCase();
    const options = [...el.options];
    const found = options.find((option) => option.textContent.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle));
    return found?.value || "";
  }, contains);
  if (!value) throw new Error(`no option containing ${contains}`);
  await locator.selectOption(value);
}

function resolveFieldValue(field, profileValues) {
  if (field.valueFrom) return profileValues[field.valueFrom] || "";
  if (Object.prototype.hasOwnProperty.call(field, "value")) return field.value;
  return "";
}

function loadManifest(path) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) throw new Error(`manifest not found: ${path}`);
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`invalid manifest JSON ${path}: ${error.message}`);
  }
}

function resolveManifestPath(value, work) {
  if (!value) return "";
  if (isAbsolute(value)) return value;
  return join(work, value);
}

function arrayOf(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function ok(label, detail) { return { label, status: "ok", detail }; }
function skipped(label, detail) { return { label, status: "skipped", detail }; }
function truthy(value) { return [true, "true", "yes", "y", "1"].includes(typeof value === "string" ? value.toLowerCase() : value); }
function isMain() { return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href; }
