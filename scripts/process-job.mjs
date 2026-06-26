// Process a LinkedIn job: fetch JD, detect top applicant, extract apply URL, save job.
//
// Usage:
//   node scripts/process-job.mjs <url>
//   node scripts/process-job.mjs <url> --out <dir>     (save job.md + metadata)
//
// Output: JSON to stdout with { url, title, company, topApplicant, applyUrl, saved, ... }

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { createServer } from "node:net";
import { resolveBrowserPath } from "../engine/config.mjs";

const PROFILE_DIR = join(homedir(), ".linkedin-chrome-profile");
const args = parseArgs(process.argv.slice(2));

if (!args.url) {
  console.error("Usage: node scripts/process-job.mjs <url> [--out <dir>]");
  process.exit(2);
}

if (!existsSync(PROFILE_DIR)) {
  console.error("No LinkedIn Chrome profile. Run: node scripts/save-linkedin-cookies.mjs");
  process.exit(1);
}

const result = await processJob(args.url, args.out);
console.log(JSON.stringify(result, null, 2));

// ── Core ──────────────────────────────────────────────────────────────────

async function processJob(url, outDir) {
  const lockFile = join(PROFILE_DIR, "SingletonLock");
  try { require("fs").unlinkSync(lockFile); } catch {}

  const port = await findFreePort();
  const chromeProc = spawn(
    resolveBrowserPath(),
    [
      `--user-data-dir=${PROFILE_DIR}`, `--remote-debugging-port=${port}`,
      "--headless=new", "--disable-gpu", "--no-first-run", "--no-sandbox",
      "--disable-blink-features=AutomationControlled", "--disable-features=TranslateUI",
      "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "--window-size=1920,1080", "about:blank",
    ],
    { stdio: "pipe" }
  );

  await sleep(3000);

  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    const page = browser.contexts()[0].pages()[0];

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5000);

    const html = await page.content();

    // 1. Extract job details
    const jobInfo = await page.evaluate(() => {
      // Parse from page title: "Product Owner | Corpay | LinkedIn"
      const pageTitle = document.title || "";
      const parts = pageTitle.split(" | ");
      const title = parts[0] || "";
      const company = parts[1] || "";

      // Location: find line with "·" containing city/region pattern
      const bodyLines = document.body.innerText.split("\n").map(l => l.trim()).filter(Boolean);
      let location = "";
      for (const line of bodyLines) {
        // Match: "Vancouver, BC · Reposted..." or "Vancouver, British Columbia · ..."
        if (line.includes("·") && /[A-Z][a-z]+,\s*(BC|ON|QC|AB|MB|SK|NS|NB|NL|PE|NT|YT|NU|[A-Z][a-z]+)/i.test(line)) {
          location = line.split("·")[0].trim();
          break;
        }
      }
      // Fallback: look in the first 20 lines for a city pattern
      if (!location) {
        for (let i = 0; i < Math.min(20, bodyLines.length); i++) {
          const line = bodyLines[i];
          if (/^[A-Z][a-z]+,\s*(BC|ON|QC|AB|MB|SK|NS|NB|NL|PE|NT|YT|NU|British Columbia|Ontario|Quebec|Alberta)/i.test(line)) {
            location = line;
            break;
          }
        }
      }

      // Description: text between "About the job" and "About the company" or end
      const aboutIdx = bodyLines.findIndex(l => l.toLowerCase() === "about the job");
      const aboutCompanyIdx = bodyLines.findIndex((l, i) => i > (aboutIdx >= 0 ? aboutIdx + 1 : 0) && l.toLowerCase() === "about the company");
      const descLines = bodyLines.slice(
        aboutIdx >= 0 ? aboutIdx + 1 : 0,
        aboutCompanyIdx > 0 ? aboutCompanyIdx : undefined
      );
      let description = descLines.join("\n").trim();
      // Remove non-JD content from the description (like "Set alert", "People you can reach")
      description = description.replace(/\nSet alert for similar jobs[\s\S]*$/, "").trim();

      // Compensation
      let comp = "";
      const fullText = bodyLines.join("\n");
      const compMatch = fullText.match(/\$[\d,]+(?:\s*[-–]\s*\$?[\d,]+)?(?:\s*(?:CAD|USD|\/\s*year|per year|a year)?)?/i);
      if (compMatch) comp = compMatch[0].trim();

      return { company, title, location, description, compensation: comp };
    });

    // 2. Check for top applicant
    const topApplicant = /top applicant/i.test(html);

    // 3. Extract Apply URL
    const applyInfo = await page.evaluate(() => {
      const all = document.querySelectorAll("a, button");
      for (const el of all) {
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        const text = (el.textContent || "").trim().toLowerCase();
        if ((aria.includes("apply") && !aria.includes("applied")) || 
            (text === "apply" && el.tagName === "A")) {
          return {
            tag: el.tagName,
            href: el.getAttribute("href") || "",
            ariaLabel: el.getAttribute("aria-label") || "",
            text: (el.textContent || "").trim(),
          };
        }
      }
      return null;
    });

    let applyUrl = null;
    let isEasyApply = false;
    let isExternalApply = false;

    if (applyInfo) {
      if (applyInfo.href) {
        // LinkedIn wraps external URLs in /safety/go/?url=...
        const safetyMatch = applyInfo.href.match(/[?&]url=([^&]+)/);
        if (safetyMatch) {
          applyUrl = decodeURIComponent(safetyMatch[1]);
          isExternalApply = true;
        } else if (applyInfo.href.startsWith("http")) {
          applyUrl = applyInfo.href;
        } else {
          applyUrl = "https://www.linkedin.com" + applyInfo.href;
        }
      }
      if (applyInfo.ariaLabel.toLowerCase().includes("easy apply") || 
          applyInfo.text.toLowerCase().includes("easy apply")) {
        isEasyApply = true;
        isExternalApply = false;
      }
    }

    // 4. Save the job
    let saved = false;
    let wasAlreadySaved = false;

    try {
      // Check current save state
      const saveState = await page.evaluate(() => {
        const buttons = document.querySelectorAll("button");
        for (const b of buttons) {
          const aria = (b.getAttribute("aria-label") || "").toLowerCase();
          if (aria.includes("save")) {
            return {
              ariaLabel: b.getAttribute("aria-label") || "",
              isSaved: aria.includes("saved") || aria.includes("unsave"),
            };
          }
        }
        return null;
      });

      if (saveState && !saveState.isSaved) {
        // Click save
        await page.click('button[aria-label*="Save"]', { timeout: 5000 });
        await page.waitForTimeout(2000);
        
        // Verify it saved
        const savedState = await page.evaluate(() => {
          const buttons = document.querySelectorAll("button");
          for (const b of buttons) {
            const aria = (b.getAttribute("aria-label") || "").toLowerCase();
            if (aria.includes("unsave") || aria.includes("saved")) return true;
          }
          return false;
        });
        saved = savedState;
      } else if (saveState?.isSaved) {
        wasAlreadySaved = true;
        saved = true; // already saved = effectively saved
      }
    } catch (e) {
      console.error("Save click failed:", e.message);
    }

    await browser.close();

    const result = {
      url,
      company: jobInfo.company,
      title: jobInfo.title,
      location: jobInfo.location,
      compensation: jobInfo.compensation,
      description: jobInfo.description,
      topApplicant,
      applyUrl,
      isEasyApply,
      isExternalApply,
      saved,
      wasAlreadySaved,
      fetched: new Date().toISOString().slice(0, 10),
    };

    // Write output files if requested
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      
      // job.md
      const jd = `# ${jobInfo.company} — ${jobInfo.title}\n\n` +
        `- **Source:** ${url}\n` +
        `- **Company:** ${jobInfo.company}\n` +
        `- **Role:** ${jobInfo.title}\n` +
        `- **Location:** ${jobInfo.location}\n` +
        `- **Compensation:** ${jobInfo.compensation || "(not stated)"}\n` +
        `- **Fetched:** ${result.fetched}\n` +
        `- **Top Applicant:** ${topApplicant ? "Yes" : "No"}\n` +
        `- **Apply URL:** ${applyUrl || "(on LinkedIn)"}\n` +
        `- **Apply Type:** ${isEasyApply ? "Easy Apply" : isExternalApply ? "External" : "LinkedIn"}\n` +
        `- **Saved:** ${saved ? (wasAlreadySaved ? "Already saved" : "Just saved") : "Failed"}\n\n` +
        `## Job Description\n\n${jobInfo.description}\n`;

      writeFileSync(join(outDir, "job.md"), jd);

      // metadata.json
      const metadataPath = join(outDir, "metadata.json");
      const existing = readJsonIfExists(metadataPath);
      const metadata = {
        ...result,
        lifecycle: normalizeLifecycle(existing?.lifecycle),
      };
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + "\n");
    }

    return result;
  } finally {
    chromeProc.kill("SIGTERM");
    try { require("fs").unlinkSync(lockFile); } catch {}
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on("error", reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function normalizeLifecycle(lifecycle = {}) {
  return {
    status: lifecycle.status || "to_apply",
    fit: lifecycle.fit || "",
    priority: lifecycle.priority || "",
    packagePath: lifecycle.packagePath || "",
    packageReadyAt: lifecycle.packageReadyAt || "",
    appliedAt: lifecycle.appliedAt || "",
    outcome: lifecycle.outcome || "",
    lastContactAt: lifecycle.lastContactAt || "",
    variant: lifecycle.variant || "",
    notes: lifecycle.notes || "",
    emailEvents: Array.isArray(lifecycle.emailEvents) ? lifecycle.emailEvents : [],
  };
}

function parseArgs(args) {
  const p = { url: "", out: "" };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") p.out = args[++i] || "";
    else if (!args[i].startsWith("--") && !p.url) p.url = args[i];
  }
  return p;
}
