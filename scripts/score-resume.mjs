// Ship-check scorer for tailored resumes. See eval-rubric.md for gate definitions.
// Usage:
//   node scripts/score-resume.mjs --source <resume.md> [--html <default-variant.html>] \
//     [--pdf <resume.pdf>] [--terms-hard "a,b"] [--terms-soft "c,d"] \
//     [--terms-context "e,f"]
// Output: one `score: <HARD|SOFT|REPORT> <check> <status> ...` line per check.
// Exit non-zero only when a HARD check is FAIL or UNVERIFIED.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, loadProfile, resolveBrowserPath } from "../engine/config.mjs";
import { validateResumeProtectedFacts } from "../engine/resume-protected-facts.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const options = parseArgs(process.argv.slice(2));
if (!options.source) throw new Error("--source <resume.md> is required");

const results = [];
function record(tier, name, status, detail = "") {
  results.push({ tier, name, status, detail });
}

// ---------- markdown checks ----------

const markdown = readFileSync(options.source, "utf8");
const profile = loadProfile(loadConfig());
const protectedFactErrors = validateResumeProtectedFacts(markdown, profile);
record(
  "HARD",
  "protected_identity_contact_links",
  protectedFactErrors.length ? "FAIL" : "PASS",
  protectedFactErrors.join("; "),
);
const sections = parseSections(markdown);
const allBullets = sections.flatMap((section) =>
  section.bullets.map((text, i) => ({ section: section.title, n: i + 1, text })),
);

const BANNED = [
  "responsible for",
  "helped",
  "worked on",
  "assisted",
  "utilized",
  "leveraged",
  "spearheaded",
  "synergy",
  "various",
];
const bannedHits = [];
for (const bullet of allBullets) {
  const plain = stripBold(bullet.text).toLowerCase();
  for (const phrase of BANNED) {
    if (new RegExp(`\\b${phrase}\\b`).test(plain)) {
      bannedHits.push(`"${phrase}" in ${bullet.section} #${bullet.n}`);
    }
  }
}
record("HARD", "banned_words", bannedHits.length ? "FAIL" : "PASS", bannedHits.join("; "));

const openerFails = [];
for (const section of sections) {
  for (let i = 1; i < section.bullets.length; i += 1) {
    const prev = openerOf(section.bullets[i - 1]);
    const curr = openerOf(section.bullets[i]);
    if (prev && prev === curr) {
      openerFails.push(`section="${section.title}" bullets=${i},${i + 1} opener="${curr}"`);
    }
  }
}
record("SOFT", "duplicate_openers", openerFails.length ? "FAIL" : "PASS", openerFails.join("; "));

const metricMap = new Map();
for (const bullet of allBullets) {
  const tokens = new Set(
    (stripBold(bullet.text).match(/\$?\d[\d,.]*\s*(?:%|[KMB]\b)?/g) ?? [])
      .map((token) => token.replace(/\s+/g, ""))
      .filter((token) => /%|\$|[KMB]|,/.test(token) || token.replace(/\D/g, "").length >= 2),
  );
  for (const token of tokens) {
    if (!metricMap.has(token)) metricMap.set(token, []);
    metricMap.get(token).push(`${bullet.section} #${bullet.n}`);
  }
}
const repeatedMetrics = [...metricMap.entries()].filter(([, where]) => where.length >= 2);
record(
  "SOFT",
  "repeated_metrics",
  repeatedMetrics.length ? "FAIL" : "PASS",
  repeatedMetrics.map(([value, where]) => `value=${value} (${where.join("; ")})`).join(" · "),
);

const quantified = allBullets.filter((bullet) => /\d/.test(bullet.text)).length;
record("REPORT", "quantified_ratio", `${quantified}/${allBullets.length}`);

const multiBold = allBullets.filter(
  (bullet) => (bullet.text.match(/\*\*[^*]+\*\*/g) ?? []).length > 1,
);
record(
  "REPORT",
  "bold_spans",
  multiBold.length
    ? `${multiBold.length} bullets with >1 bold: ${multiBold.map((b) => `${b.section} #${b.n}`).join("; ")}`
    : "no bullet has >1 bold span",
);

record(
  "REPORT",
  "bullet_taper",
  sections.map((section) => `${section.title}=${section.bullets.length}`).join(" · "),
);

// ---------- PDF checks (pages + term presence) ----------

const termsHard = splitTerms(options.termsHard);
const termsSoft = splitTerms(options.termsSoft);
const termsContext = splitTerms(options.termsContext);

if (termsContext.length) {
  const skillsText = extractSection(markdown, "SKILLS").toLowerCase();
  const hits = termsContext.filter((term) => skillsText.includes(term.toLowerCase()));
  record(
    "REPORT",
    "suspicious_context_skill",
    hits.length ? `${hits.length} context terms in skills: ${hits.join(",")}` : "no context terms found in skills",
  );
}

if (options.pdf) {
  const pythonCheck = `
import json, sys
try:
    import pdfplumber
except ImportError:
    print(json.dumps({"error": "pdfplumber not installed"})); sys.exit(0)
pdf = pdfplumber.open(sys.argv[1])
text = " ".join(" ".join((page.extract_text() or "").split()) for page in pdf.pages)
print(json.dumps({"pages": len(pdf.pages), "text": text}))
`;
  const run = spawnSync("python3", ["-c", pythonCheck, options.pdf], { encoding: "utf8" });
  let pdfInfo = null;
  try {
    pdfInfo = JSON.parse(run.stdout.trim());
  } catch {
    pdfInfo = null;
  }
  if (!pdfInfo || pdfInfo.error) {
    record("HARD", "page_fit", "UNVERIFIED", pdfInfo?.error ?? "pdf text extraction failed — install pdfplumber (pip3 install pdfplumber)");
    if (termsHard.length) record("HARD", "hard_terms", "UNVERIFIED", "no PDF text to search");
    if (termsSoft.length) record("SOFT", "soft_terms", "SKIPPED", "no PDF text to search");
  } else {
    record("HARD", "page_fit", pdfInfo.pages === 2 ? "PASS" : "FAIL", `pages=${pdfInfo.pages}`);
    const haystack = pdfInfo.text.toLowerCase();
    if (haystack.length < 1000) record("HARD", "page_fit", "FAIL", `extracted text suspiciously short (${haystack.length} chars)`);
    if (termsHard.length) {
      const missing = termsHard.filter((term) => !haystack.includes(term.toLowerCase()));
      record("HARD", "hard_terms", missing.length ? "FAIL" : "PASS", `found=${termsHard.length - missing.length}/${termsHard.length}${missing.length ? ` missing=${missing.join(",")}` : ""}`);
    }
    if (termsSoft.length) {
      const missing = termsSoft.filter((term) => !haystack.includes(term.toLowerCase()));
      record("SOFT", "soft_terms", missing.length ? "FAIL" : "PASS", `found=${termsSoft.length - missing.length}/${termsSoft.length}${missing.length ? ` missing=${missing.join(",")}` : ""}`);
    }
  }
} else {
  record("HARD", "page_fit", "UNVERIFIED", "no --pdf provided");
  if (termsHard.length) record("HARD", "hard_terms", "UNVERIFIED", "no --pdf provided");
}

// ---------- rendered checks (bullet height + orphans, default variant) ----------

if (options.html) {
  const chromePath = resolveBrowserPath();
  const tempDir = mkdtempSync(join(tmpdir(), "resume-score-"));
  try {
    const injected = join(tempDir, "injected.html");
    const inject = spawnSync(
      "node",
      [join(scriptsDir, "inject-line-wrap-analyzer.mjs"), options.html, injected],
      { encoding: "utf8" },
    );
    if (inject.status !== 0) throw new Error(inject.stderr || "analyzer injection failed");
    const dump = spawnSync(
      chromePath,
      ["--headless", "--disable-gpu", "--no-first-run", "--window-size=1100,1450", "--dump-dom", pathToFileURL(injected).href],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const match = dump.stdout.match(/LINE_WRAP_REPORT_START\n([\s\S]*?)\nLINE_WRAP_REPORT_END/);
    if (!match) throw new Error("line-wrap report not found in DOM dump");
    const report = JSON.parse(decodeEntities(match[1]));
    const tall = report.bullets.filter((bullet) => bullet.lines > 2);
    record(
      "SOFT",
      "bullet_height",
      tall.length ? "FAIL" : "PASS",
      tall.length ? tall.map((b) => `li#${b.index} lines=${b.lines} "${b.text.slice(0, 50)}…"`).join("; ") : `all ${report.bullets.length} bullets ≤2 lines`,
    );
    record(
      "SOFT",
      "orphan_lines",
      report.orphans.length ? "FAIL" : "PASS",
      report.orphans.map((o) => `li#${o.index} lastLine="${o.lastLine}"`).join("; "),
    );
  } catch (error) {
    // Do not fail open: a check that errored is unverified, not skipped.
    // Shipped packages have gone out with layout flaws under a silent SKIPPED.
    record("SOFT", "bullet_height", "UNVERIFIED", String(error.message ?? error));
    record("SOFT", "orphan_lines", "UNVERIFIED", String(error.message ?? error));
    console.error("WARNING: line-wrap checks did not run (" + String(error.message ?? error) + "). Re-run before shipping or waive with a written reason.");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------- output ----------

for (const result of results) {
  const parts = [`score: ${result.tier} ${result.name}`];
  if (result.status) parts.push(result.status);
  if (result.detail) parts.push(result.detail);
  console.log(parts.join(" "));
}
const hardBlockers = results.filter(
  (result) => result.tier === "HARD" && (result.status === "FAIL" || result.status === "UNVERIFIED"),
);
const softPending = results.filter(
  (result) => result.tier === "SOFT" && (result.status === "FAIL" || result.status === "UNVERIFIED"),
);
if (hardBlockers.length) {
  console.log(`ship: BLOCKED (${hardBlockers.length} hard gate${hardBlockers.length > 1 ? "s" : ""}: ${hardBlockers.map((r) => r.name).join(", ")})`);
  process.exit(1);
}
console.log(
  softPending.length
    ? `ship: OK pending ${softPending.length} soft issue${softPending.length > 1 ? "s" : ""} (fix, re-run, or waive: ${softPending.map((r) => `${r.name}[${r.status}]`).join(", ")}) — latent checklist (eval-rubric.md §3) still applies`
    : "ship: OK — latent checklist (eval-rubric.md §3) still applies",
);

// ---------- helpers ----------

function parseArgs(args) {
  const parsed = {};
  const keys = { "--source": "source", "--html": "html", "--pdf": "pdf", "--terms-hard": "termsHard", "--terms-soft": "termsSoft", "--terms-context": "termsContext" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const eq = arg.indexOf("=");
    if (eq > 0 && keys[arg.slice(0, eq)]) {
      parsed[keys[arg.slice(0, eq)]] = arg.slice(eq + 1);
    } else if (keys[arg]) {
      parsed[keys[arg]] = args[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function parseSections(text) {
  const sections = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("### ")) {
      current = { title: line.slice(4).split("—")[0].trim(), bullets: [] };
      sections.push(current);
    } else if (line.startsWith("## ")) {
      current = null;
    } else if (current && line.startsWith("- ")) {
      current.bullets.push(line.slice(2).trim());
    }
  }
  return sections.filter((section) => section.bullets.length > 0);
}

function stripBold(text) {
  return text.replaceAll("**", "");
}

function openerOf(bullet) {
  const words = stripBold(bullet).toLowerCase().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ");
}

function splitTerms(raw) {
  return (raw ?? "").split(",").map((term) => term.trim()).filter(Boolean);
}

function extractSection(text, sectionName) {
  const lines = text.split(/\r?\n/);
  const target = `## ${sectionName}`;
  const start = lines.findIndex((line) => line.trim().toUpperCase() === target);
  if (start === -1) return "";
  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("## ")) break;
    collected.push(line);
  }
  return collected.join("\n");
}

function decodeEntities(text) {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
