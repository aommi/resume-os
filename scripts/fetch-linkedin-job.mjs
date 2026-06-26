// Fetch a LinkedIn (or generic) job posting via local headless Chrome and emit
// clean, job.md-ready text. Uses a real browser because LinkedIn blocks plain
// HTTP requests; parses the LinkedIn guest-view DOM (og:title + markup).
//
// Usage:
//   node scripts/fetch-linkedin-job.mjs <url>
//   node scripts/fetch-linkedin-job.mjs <url> --out "applications/<Company - Role>/job.md"
//   node scripts/fetch-linkedin-job.mjs --url <url> --json   (machine-readable)
//
// Exit non-zero (and write nothing) if the JD body can't be extracted, so a
// login wall / layout change fails loud instead of producing an empty job.md.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";

const options = parseArgs(process.argv.slice(2));
if (!options.url) {
  console.error("usage: node scripts/fetch-linkedin-job.mjs <url> [--out <path>] [--json]");
  process.exit(2);
}

const html = renderDom(options.url);
const job = extractJob(html, options.url);

if (!job.description || job.description.length < 200) {
  console.error(
    `fetch FAILED: could not extract a job description from ${options.url}\n` +
      "Likely a login wall or a changed layout. Open the link in a browser and paste the JD manually.",
  );
  process.exit(1);
}

if (options.json) {
  console.log(JSON.stringify(job, null, 2));
} else {
  const md = toJobMarkdown(job);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, md);
    console.error(`wrote: ${options.out} (${job.description.length} chars of JD)`);
  } else {
    console.log(md);
  }
}

function parseArgs(args) {
  const parsed = { url: "", out: "", json: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--url") parsed.url = args[++i] ?? "";
    else if (a === "--out") parsed.out = args[++i] ?? "";
    else if (a === "--json") parsed.json = true;
    else if (!a.startsWith("--") && !parsed.url) parsed.url = a;
  }
  return parsed;
}

function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("No headless Chrome/Chromium/Edge found in /Applications.");
  return found;
}

function renderDom(url) {
  const chrome = findChrome();
  const result = spawnSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--no-first-run",
      "--no-sandbox",
      "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--virtual-time-budget=10000",
      "--dump-dom",
      url,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (!result.stdout) throw new Error("Chrome returned no DOM (network error or blocked).");
  return result.stdout;
}

function extractJob(html, url) {
  const ogTitle = (html.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || "";
  // LinkedIn format: "{Company} hiring {Title} in {Location} | LinkedIn"
  const m = ogTitle.match(/^(.*?) hiring (.*?) in (.*?) \| LinkedIn$/);
  const company = m ? decode(m[1].trim()) : "";
  const title = m ? decode(m[2].trim()) : decode(ogTitle.replace(/ \| LinkedIn$/, "").trim());
  const location = m ? decode(m[3].trim()) : "";

  // JD body: primary = guest-view markup div; fallbacks for layout drift.
  let body =
    (html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/) || [])[1] ||
    (html.match(/class="description__text[^"]*"[^>]*>([\s\S]*?)<\/section>/) || [])[1] ||
    "";
  let description = htmlToText(body);
  if (!description) {
    // Last resort: og:description (usually truncated, but better than nothing).
    description = decode((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "");
  }

  const comp = (description.match(/\$[\d,]+\s*[-–]\s*\$?[\d,]+(?:\s*(?:CAD|USD|\/\s*year|per year)?)?/i) || [])[0] || "";

  return { source: url, company, title, location, compensation: comp, description };
}

function htmlToText(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/(p|li|ul|ol|h[1-6]|div|section)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => decode(line).trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decode(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<");
}

function toJobMarkdown(job) {
  return `# ${job.company || "Unknown"} — ${job.title || "Unknown role"}

- **Source:** ${job.source}
- **Company:** ${job.company || "(unparsed)"}
- **Role:** ${job.title || "(unparsed)"}
- **Location:** ${job.location || "(unparsed)"}
- **Compensation:** ${job.compensation || "(not stated)"}
- **Fetched:** ${new Date().toISOString().slice(0, 10)}

## Job Description

${job.description}
`;
}
