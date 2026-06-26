#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { workDir, timezone } from "../engine/config.mjs";

const WORK = workDir();
const INBOX_DIR = join(WORK, "inbox");
const PENDING_DIR = join(WORK, "events/pending");
const ARCHIVE_DIR = join(WORK, "events/archive");
const REJECTED_DIR = join(WORK, "events/rejected");
const DIGEST_PATH = join(WORK, "events/digest.md");
const REVIEWS_PATH = join(WORK, "events/reviews.md");
const TIME_ZONE = timezone();
const VALID_STATUSES = new Set([
  "to_review",
  "to_apply",
  "package_ready",
  "applied",
  "needs_action",
  "interviewing",
  "skipped",
  "closed",
]);
const DEFAULT_LIFECYCLE = {
  status: "to_apply",
  fit: "",
  priority: "",
  packagePath: "",
  packageReadyAt: "",
  appliedAt: "",
  outcome: "",
  lastContactAt: "",
  variant: "",
  notes: "",
  emailEvents: [],
};

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const includeLowConfidence = args.has("--include-low-confidence");

try {
  const result = importEvents();
  printSummary(result);
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

function importEvents() {
  ensureDirs();
  const jobs = loadJobs();
  const importedMessageIds = new Set([
    ...existingMessageIds(jobs),
    ...existingReviewMessageIds(),
  ]);
  const pendingFiles = readdirSync(PENDING_DIR)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => !name.startsWith("."))
    .sort();
  const summary = {
    files: 0,
    imported: 0,
    duplicates: 0,
    review: 0,
    archived: 0,
    rejected: 0,
    created: 0,
    dryRun,
  };

  for (const fileName of pendingFiles) {
    const filePath = join(PENDING_DIR, fileName);
    const text = readFileSync(filePath, "utf8");
    const events = parseEventFile(text);
    if (events.length === 0) continue;
    summary.files += 1;

    const fileLog = {
      imported: [],
      duplicates: [],
      review: [],
    };

    for (const event of events) {
      const messageId = event.message_id || "";
      if (messageId && importedMessageIds.has(messageId)) {
        fileLog.duplicates.push(event);
        summary.duplicates += 1;
        continue;
      }

      const decision = classifyEvent(event, jobs);
      if (decision.action === "review") {
        fileLog.review.push({ ...event, review_reason: decision.reason });
        summary.review += 1;
        if (messageId) importedMessageIds.add(messageId);
        continue;
      }

      let job = decision.job;
      if (!job) {
        job = createJobFromEvent(event);
        jobs.set(job.id, job);
        summary.created += 1;
      }

      applyEvent(job, event, filePath);
      fileLog.imported.push(event);
      summary.imported += 1;
      if (messageId) importedMessageIds.add(messageId);
    }

    if (!dryRun) {
      for (const job of jobs.values()) {
        if (job.dirty) saveJob(job);
      }
      if (fileLog.review.length) appendDigest(filePath, fileLog.review);
      appendReview(filePath, fileLog);
      const destination = fileLog.imported.length || fileLog.duplicates.length
        ? join(ARCHIVE_DIR, basename(filePath))
        : join(REJECTED_DIR, basename(filePath));
      moveFile(filePath, destination);
      if (destination.startsWith(ARCHIVE_DIR)) summary.archived += 1;
      else summary.rejected += 1;
    }
  }

  if (!dryRun) {
    const render = spawnSync(process.execPath, ["scripts/job-board.mjs", "render"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (render.status !== 0) {
      throw new Error(`job-board render failed: ${render.stderr || render.stdout}`);
    }
  }

  return summary;
}

function classifyEvent(event, jobs) {
  const confidence = normalize(event.confidence);
  if (!event.message_id) return { action: "review", reason: "missing message_id" };
  if (!includeLowConfidence && confidence === "low") {
    return { action: "review", reason: "low confidence" };
  }

  const explicitJobId = cleanValue(event.job_id);
  if (explicitJobId) {
    const job = jobs.get(explicitJobId);
    if (!job) {
      if (hasUsableCompanyAndRole(event)) return { action: "import" };
      return { action: "review", reason: `unknown job_id ${explicitJobId}` };
    }
    return { action: "import", job };
  }

  const matched = findMatchingJob(event, jobs);
  if (matched) return { action: "import", job: matched };

  if (confidence === "high" && hasUsableCompanyAndRole(event)) {
    return { action: "import" };
  }
  return { action: "review", reason: "unmatched event" };
}

function applyEvent(job, event, sourceFile) {
  const lifecycle = job.metadata.lifecycle;
  const date = cleanValue(event.event_date) || today();
  const eventName = cleanValue(event.event).toLowerCase();
  lifecycle.emailEvents.push({
    messageId: cleanValue(event.message_id),
    threadId: cleanValue(event.thread_id),
    event: eventName,
    date,
    confidence: cleanValue(event.confidence),
    sourceFile,
  });
  lifecycle.lastContactAt = maxDate(lifecycle.lastContactAt, date);

  if (eventName === "confirmation") {
    lifecycle.status = "applied";
    lifecycle.appliedAt = lifecycle.appliedAt || date;
    lifecycle.outcome = lifecycle.outcome && lifecycle.outcome !== "Package ready"
      ? lifecycle.outcome
      : "Submitted";
  } else if (eventName === "rejection") {
    lifecycle.status = "closed";
    lifecycle.outcome = "Rejected";
  } else if (["interview", "recruiter_screen", "hiring_manager"].includes(eventName)) {
    lifecycle.status = "interviewing";
    lifecycle.outcome = eventName === "recruiter_screen" ? "Recruiter screen" : "Interview";
  } else if (eventName === "assessment" || /action required/i.test(event.subject || "")) {
    lifecycle.status = "needs_action";
    lifecycle.outcome = "Action required";
  }

  const note = cleanValue(event.notes);
  if (note && !String(lifecycle.notes || "").includes(note)) {
    lifecycle.notes = [lifecycle.notes, note].filter(Boolean).join(" ");
  }
  job.dirty = true;
}

function createJobFromEvent(event) {
  const company = cleanValue(event.company);
  const role = cleanValue(event.role);
  const id = uniqueEmailJobId(company, role);
  const date = cleanValue(event.event_date) || today();
  const metadata = {
    url: "",
    company,
    title: role,
    location: "",
    compensation: "",
    description: `Created from Gmail ${cleanValue(event.event) || "email"} event.`,
    topApplicant: false,
    applyUrl: "",
    isEasyApply: false,
    isExternalApply: true,
    saved: false,
    wasAlreadySaved: false,
    fetched: date,
    source: "gmail_event",
    lifecycle: {
      ...DEFAULT_LIFECYCLE,
      status: "to_review",
      priority: "",
      notes: cleanValue(event.notes),
      emailEvents: [],
    },
  };
  const dir = join(INBOX_DIR, id);
  return { id, dir, metadataPath: join(dir, "metadata.json"), metadata, dirty: true };
}

function loadJobs() {
  const jobs = new Map();
  if (!existsSync(INBOX_DIR)) return jobs;
  for (const entry of readdirSync(INBOX_DIR)) {
    const dir = join(INBOX_DIR, entry);
    const metadataPath = join(dir, "metadata.json");
    if (!safeIsDirectory(dir) || !existsSync(metadataPath)) continue;
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    metadata.lifecycle = normalizeLifecycle(metadata.lifecycle);
    jobs.set(entry, { id: entry, dir, metadataPath, metadata, dirty: false });
  }
  return jobs;
}

function saveJob(job) {
  if (!existsSync(job.dir)) mkdirSync(job.dir, { recursive: true });
  job.metadata.lifecycle = normalizeLifecycle(job.metadata.lifecycle);
  writeFileSync(job.metadataPath, JSON.stringify(job.metadata, null, 2) + "\n");
  job.dirty = false;
}

function normalizeLifecycle(lifecycle = {}) {
  const normalized = { ...DEFAULT_LIFECYCLE, ...lifecycle };
  if (!VALID_STATUSES.has(normalized.status)) normalized.status = DEFAULT_LIFECYCLE.status;
  if (!Array.isArray(normalized.emailEvents)) normalized.emailEvents = [];
  return normalized;
}

function parseEventFile(text) {
  const blocks = text.split(/^## JOB_EMAIL_EVENT\s*$/m).slice(1);
  return blocks.map(parseBlock).filter((event) => Object.keys(event).length);
}

function parseBlock(block) {
  const event = {};
  let currentKey = "";
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const match = line.match(/^- ([a-zA-Z0-9_]+):\s*(.*)$/);
    if (match) {
      currentKey = match[1];
      event[currentKey] = unquote(match[2].trim());
    } else if (currentKey && line.trim()) {
      event[currentKey] = `${event[currentKey]} ${line.trim()}`.trim();
    }
  }
  return event;
}

function findMatchingJob(event, jobs) {
  const company = normalize(event.company);
  const role = normalize(event.role);
  if (!company || company === "unknown" || !role || role === "unknown") return null;
  const matches = [...jobs.values()].filter((job) =>
    normalize(job.metadata.company) === company &&
    normalize(job.metadata.title) === role
  );
  return matches.length === 1 ? matches[0] : null;
}

function existingMessageIds(jobs) {
  const ids = new Set();
  for (const job of jobs.values()) {
    for (const event of job.metadata.lifecycle.emailEvents || []) {
      if (event.messageId) ids.add(event.messageId);
    }
  }
  return ids;
}

function existingReviewMessageIds() {
  const ids = new Set();
  for (const path of [DIGEST_PATH, REVIEWS_PATH]) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const match of text.matchAll(/message_id:\s*([^\s]+)/g)) {
      if (match[1]) ids.add(match[1].trim());
    }
    for (const match of text.matchAll(/messageId["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]+)/g)) {
      if (match[1]) ids.add(match[1].trim());
    }
  }
  return ids;
}

function hasUsableCompanyAndRole(event) {
  const company = cleanValue(event.company);
  const role = cleanValue(event.role);
  return Boolean(company && role && !/unknown/i.test(company) && !/unknown/i.test(role));
}

function appendDigest(filePath, events) {
  const lines = [
    "",
    `## Human Review Needed — ${basename(filePath)} (${timestamp()})`,
    "",
    ...events.flatMap((event) => [
      `- ${cleanValue(event.company) || "Unknown"} — ${cleanValue(event.role) || "Unknown"} (${cleanValue(event.event) || "event"}, ${cleanValue(event.event_date) || "unknown date"})`,
      `  - reason: ${event.review_reason}`,
      `  - subject: ${cleanValue(event.subject) || ""}`,
      `  - message_id: ${cleanValue(event.message_id) || ""}`,
      `  - notes: ${cleanValue(event.notes) || ""}`,
    ]),
  ];
  appendFileSync(DIGEST_PATH, `${lines.join("\n")}\n`);
}

function appendReview(filePath, fileLog) {
  const decision = fileLog.review.length && !fileLog.imported.length && !fileLog.duplicates.length
    ? "needs_human_review"
    : "imported_with_review_items";
  const notes = [
    `${fileLog.imported.length} imported`,
    `${fileLog.duplicates.length} duplicate`,
    `${fileLog.review.length} review`,
  ].join("; ");
  appendFileSync(REVIEWS_PATH, [
    "",
    "## EVENT_FILE_REVIEW",
    `- file: ${filePath}`,
    `- reviewed_at: ${timestamp()}`,
    "- reviewed_by: Codex",
    "- model: GPT-5",
    `- decision: ${decision}`,
    `- notes: ${notes}`,
    "",
  ].join("\n"));
}

function moveFile(source, destination) {
  let target = destination;
  if (existsSync(target)) {
    const stamp = timestamp().replace(/[^0-9]/g, "").slice(0, 14);
    target = destination.replace(/\.md$/, `-${stamp}.md`);
  }
  renameSync(source, target);
}

function uniqueEmailJobId(company, role) {
  const base = `email-${slug(company)}-${slug(role)}`.slice(0, 90).replace(/-+$/g, "");
  let id = base || `email-event-${Date.now()}`;
  let suffix = 2;
  while (existsSync(join(INBOX_DIR, id))) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function ensureDirs() {
  for (const dir of [PENDING_DIR, ARCHIVE_DIR, REJECTED_DIR, INBOX_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  for (const file of [DIGEST_PATH, REVIEWS_PATH]) {
    if (!existsSync(file)) writeFileSync(file, "");
  }
}

function printSummary(summary) {
  const mode = summary.dryRun ? "dry-run" : "import";
  console.log([
    `${mode}: ${summary.files} file(s) scanned`,
    `imported: ${summary.imported}`,
    `created: ${summary.created}`,
    `duplicates: ${summary.duplicates}`,
    `review: ${summary.review}`,
    `archived: ${summary.archived}`,
    `rejected: ${summary.rejected}`,
  ].join("\n"));
}

function maxDate(a, b) {
  if (!a) return b || "";
  if (!b) return a || "";
  return a >= b ? a : b;
}

function cleanValue(value = "") {
  return String(value || "").trim();
}

function normalize(value = "") {
  return cleanValue(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(value = "") {
  return normalize(value).replace(/\s+/g, "-");
}

function unquote(value) {
  return value.replace(/^"(.*)"$/s, "$1");
}

function safeIsDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function timestamp() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${TIME_ZONE}`;
}
