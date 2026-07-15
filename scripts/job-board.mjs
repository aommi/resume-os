#!/usr/bin/env node
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { timezone, workDir } from "../engine/config.mjs";

const WORK = workDir();
const INBOX_DIR = join(WORK, "inbox");
const TRACKER_PATH = join(WORK, "jobs-tracker.md");
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
const STATUS_ORDER = {
  to_review: 0,
  to_apply: 1,
  package_ready: 2,
  applied: 3,
  needs_action: 4,
  interviewing: 5,
  skipped: 6,
  closed: 7,
};
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

const args = process.argv.slice(2);
const command = args[0] || "help";

try {
  if (command === "render") {
    const jobs = loadJobs({ persistLifecycle: true });
    writeTracker(jobs);
  } else if (command === "list") {
    const status = args[1] || "to_apply";
    assertStatus(status);
    const jobs = loadJobs({ persistLifecycle: false });
    printList(jobs.filter((job) => job.lifecycle.status === status));
  } else if (command === "package-ready") {
    const target = requiredArg(args[1], "package-ready requires <job-id|company>");
    const options = parseOptions(args.slice(2));
    const jobs = loadJobs({ persistLifecycle: true });
    const job = findJob(jobs, target);
    job.lifecycle.packagePath = options.package || job.lifecycle.packagePath;
    job.lifecycle.variant = options.variant || job.lifecycle.variant;
    job.lifecycle.packageReadyAt = options.date || job.lifecycle.packageReadyAt || today();
    if (statusRank(job.lifecycle.status) < statusRank("package_ready")) {
      job.lifecycle.status = "package_ready";
      if (!job.lifecycle.outcome) job.lifecycle.outcome = "Package ready";
    }
    saveJob(job);
    writeTracker(loadJobs({ persistLifecycle: true }));
  } else if (command === "applied") {
    const target = requiredArg(args[1], "applied requires <job-id|company>");
    const options = parseOptions(args.slice(2));
    const jobs = loadJobs({ persistLifecycle: true });
    const job = findJob(jobs, target);
    job.lifecycle.status = "applied";
    job.lifecycle.appliedAt = options.date || job.lifecycle.appliedAt || today();
    job.lifecycle.outcome = options.outcome || job.lifecycle.outcome || "Submitted";
    job.lifecycle.lastContactAt = options.date || job.lifecycle.lastContactAt || job.lifecycle.appliedAt;
    if (options.package) job.lifecycle.packagePath = options.package;
    if (options.variant) job.lifecycle.variant = options.variant;
    saveJob(job);
    writeTracker(loadJobs({ persistLifecycle: true }));
  } else if (command === "skip") {
    const target = requiredArg(args[1], "skip requires <job-id|company>");
    const options = parseOptions(args.slice(2));
    const jobs = loadJobs({ persistLifecycle: true });
    const job = findJob(jobs, target);
    job.lifecycle.status = "skipped";
    job.lifecycle.outcome = "Skipped";
    job.lifecycle.notes = options.reason || options.notes || job.lifecycle.notes;
    job.lifecycle.lastContactAt = options.date || job.lifecycle.lastContactAt || today();
    saveJob(job);
    writeTracker(loadJobs({ persistLifecycle: true }));
  } else if (command === "outcome") {
    const target = requiredArg(args[1], "outcome requires <job-id|company>");
    const options = parseOptions(args.slice(2));
    const outcome = options.outcome || args[2];
    if (!outcome) throw new Error('outcome requires --outcome "Rejected|Screen|Interview|Offer|Ghosted"');
    const jobs = loadJobs({ persistLifecycle: true });
    const job = findJob(jobs, target);
    job.lifecycle.outcome = outcome;
    job.lifecycle.lastContactAt = options.date || today();
    if (isClosedOutcome(outcome)) job.lifecycle.status = "closed";
    else if (isInterviewOutcome(outcome)) job.lifecycle.status = "interviewing";
    else if (isActionRequiredOutcome(outcome)) job.lifecycle.status = "needs_action";
    saveJob(job);
    writeTracker(loadJobs({ persistLifecycle: true }));
  } else {
    printHelp();
    process.exit(command === "help" || command === "--help" ? 0 : 2);
  }
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

function loadJobs({ persistLifecycle }) {
  if (!existsSync(INBOX_DIR)) return [];
  const jobs = [];
  for (const entry of readdirSync(INBOX_DIR)) {
    const dir = join(INBOX_DIR, entry);
    const metadataPath = join(dir, "metadata.json");
    if (!safeIsDirectory(dir) || !existsSync(metadataPath)) continue;
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    const lifecycle = normalizeLifecycle(metadata.lifecycle);
    const job = {
      id: entry,
      dir,
      metadataPath,
      metadata: { ...metadata, lifecycle },
      lifecycle,
    };
    jobs.push(job);
    if (persistLifecycle && JSON.stringify(metadata.lifecycle || {}) !== JSON.stringify(lifecycle)) {
      saveJob(job);
    }
  }
  return jobs.sort(compareJobs);
}

function saveJob(job) {
  job.metadata.lifecycle = normalizeLifecycle(job.lifecycle);
  writeFileSync(job.metadataPath, JSON.stringify(job.metadata, null, 2) + "\n");
}

function normalizeLifecycle(lifecycle = {}) {
  const normalized = { ...DEFAULT_LIFECYCLE, ...lifecycle };
  if (!VALID_STATUSES.has(normalized.status)) normalized.status = DEFAULT_LIFECYCLE.status;
  if (!Array.isArray(normalized.emailEvents)) normalized.emailEvents = [];
  return normalized;
}

function writeTracker(jobs) {
  const discoveryDates = jobs
    .filter((job) => job.metadata.source !== "gmail_event")
    .map((job) => job.metadata.fetched)
    .filter(Boolean)
    .sort();
  const gmailRowDates = jobs
    .filter((job) => job.metadata.source === "gmail_event")
    .map((job) => job.metadata.fetched)
    .filter(Boolean);
  const emailEventDates = jobs.flatMap((job) =>
    (job.lifecycle.emailEvents || []).map((event) => event.date).filter(Boolean),
  );
  const emailImportDates = [...gmailRowDates, ...emailEventDates].sort();
  const latestDiscovery = discoveryDates.at(-1) || "";
  const latestEmailImport = emailImportDates.at(-1) || "";

  // Execution heartbeats + staleness warnings (HLT-1). The job dates above are
  // activity proxies; these read what the workflows actually recorded.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const warnings = [];
  const repoRoot = join(WORK, "..", "..", "..");
  const heartbeatPath = join(repoRoot, ".linkedin-last-checked");
  let discoveryHeartbeat = "Unknown";
  if (existsSync(heartbeatPath)) {
    const epoch = Number(readFileSync(heartbeatPath, "utf8").trim());
    if (Number.isFinite(epoch) && epoch > 0) {
      discoveryHeartbeat = new Date(epoch).toISOString().slice(0, 16).replace("T", " ") + " UTC";
      const ageDays = (Date.now() - epoch) / DAY_MS;
      if (ageDays > 1) warnings.push(`Discovery heartbeat is ${ageDays.toFixed(1)} days old (cadence: every 6h). The discovery agent is likely DOWN.`);
    }
  } else {
    warnings.push("No discovery heartbeat file found; discovery agent status unknown.");
  }
  const pendingDir = join(WORK, "events", "pending");
  const pendingCount = existsSync(pendingDir)
    ? readdirSync(pendingDir).filter((n) => n.endsWith(".md") && !n.startsWith(".")).length
    : 0;
  if (pendingCount > 0) warnings.push(`${pendingCount} event file(s) in events/pending/ not imported. Run: node scripts/import-events.mjs`);
  const eventDirs = [pendingDir, join(WORK, "events", "archive")];
  const newestEventFile = eventDirs
    .flatMap((dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".md")) : []))
    .sort()
    .at(-1);
  const monitorDate = newestEventFile ? newestEventFile.slice(0, 10) : "";
  if (monitorDate) {
    const ageDays = (Date.now() - new Date(monitorDate).getTime()) / DAY_MS;
    if (ageDays > 3) warnings.push(`Gmail monitor last ran ${monitorDate} (${Math.floor(ageDays)} days ago). Board may not reflect real application activity.`);
  } else {
    warnings.push("No Gmail monitor event files found; email sync never ran.");
  }

  const body = [
    "# Jobs Tracker",
    "",
    "> Generated from `inbox/*/metadata.json`; do not hand-edit. Use `node scripts/job-board.mjs ...`.",
    "",
    ...(warnings.length
      ? ["> **⚠ PIPELINE HEALTH WARNINGS**", ...warnings.map((w) => `> - ⚠ ${w}`), ""]
      : []),
    `- **Latest board render:** ${timestamp()}`,
    `- **Latest job discovery sync:** ${latestDiscovery || "Unknown"}`,
    `- **Discovery agent heartbeat:** ${discoveryHeartbeat}`,
    `- **Gmail monitor last run:** ${monitorDate || "Unknown"}`,
    `- **Latest email event import:** ${latestEmailImport || "Unknown"}`,
    "- **Latest application/outcome sync:** tracked per row in `Last Contact`",
    "- **Pipeline:** to_review -> to_apply -> package_ready -> applied -> needs_action / interviewing -> closed",
    "- **Dedup key:** LinkedIn job ID first, canonical URL second",
    "",
    section("To Review", jobs, "to_review", activeColumns()),
    section("To Apply", jobs, "to_apply", activeColumns()),
    section("Package Ready", jobs, "package_ready", activeColumns()),
    section("Applied", jobs, "applied", appliedColumns()),
    section("Needs Action", jobs, "needs_action", appliedColumns()),
    section("Interviewing", jobs, "interviewing", appliedColumns()),
    section("Skipped", jobs, "skipped", closedColumns()),
    section("Closed", jobs, "closed", closedColumns()),
    "",
  ].join("\n");
  writeFileSync(TRACKER_PATH, body);
  console.log(`rendered: ${TRACKER_PATH}`);
}

function section(title, jobs, status, columns) {
  const rows = jobs.filter((job) => job.lifecycle.status === status);
  return [
    `## ${title}`,
    "",
    table(columns, rows),
  ].join("\n");
}

function table(columns, jobs) {
  const header = `| ${columns.map((column) => column.label).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  if (!jobs.length) return [header, divider].join("\n");
  const rows = jobs.map((job, index) =>
    `| ${columns.map((column) => escapeCell(column.value(job, index))).join(" | ")} |`
  );
  return [header, divider, ...rows].join("\n");
}

function activeColumns() {
  return [
    column("#", (_job, index) => index + 1),
    column("ID", (job) => job.id),
    column("Found", (job) => job.metadata.fetched),
    column("Company", (job) => job.metadata.company),
    column("Role", (job) => job.metadata.title),
    column("Location", (job) => job.metadata.location),
    column("Top", (job) => yesNo(job.metadata.topApplicant)),
    column("Apply", (job) => applyType(job)),
    column("Fit", (job) => job.lifecycle.fit),
    column("Priority", (job) => job.lifecycle.priority),
    column("Package", (job) => job.lifecycle.packagePath),
    column("Variant", (job) => job.lifecycle.variant),
    column("Next Action", (job) => nextAction(job)),
    column("URL", (job) => job.metadata.url),
  ];
}

function appliedColumns() {
  return [
    column("#", (_job, index) => index + 1),
    column("ID", (job) => job.id),
    column("Applied", (job) => job.lifecycle.appliedAt || "Unknown"),
    column("Company", (job) => job.metadata.company),
    column("Role", (job) => job.metadata.title),
    column("Location", (job) => job.metadata.location),
    column("Package", (job) => job.lifecycle.packagePath),
    column("Variant", (job) => job.lifecycle.variant),
    column("Outcome", (job) => job.lifecycle.outcome),
    column("Last Contact", (job) => job.lifecycle.lastContactAt),
    column("URL", (job) => job.metadata.url),
  ];
}

function closedColumns() {
  return [
    column("#", (_job, index) => index + 1),
    column("ID", (job) => job.id),
    column("Company", (job) => job.metadata.company),
    column("Role", (job) => job.metadata.title),
    column("Outcome", (job) => job.lifecycle.outcome),
    column("Last Contact", (job) => job.lifecycle.lastContactAt),
    column("Notes", (job) => job.lifecycle.notes),
    column("URL", (job) => job.metadata.url),
  ];
}

function column(label, value) {
  return { label, value };
}

function printList(jobs) {
  for (const job of jobs) {
    const lifecycle = job.lifecycle;
    console.log([
      job.id.padEnd(10),
      (job.metadata.company || "?").padEnd(18),
      job.metadata.title || "?",
      `apply:${applyType(job)}`,
      `fit:${lifecycle.fit || "-"}`,
      `package:${lifecycle.packagePath || "-"}`,
    ].join("  "));
  }
  console.error(`${jobs.length} job${jobs.length === 1 ? "" : "s"}`);
}

function findJob(jobs, target) {
  const needle = normalize(target);
  const matches = jobs.filter((job) => {
    return (
      normalize(job.id) === needle ||
      normalize(job.metadata.company).includes(needle) ||
      normalize(job.metadata.title).includes(needle) ||
      normalize(job.metadata.url).includes(needle)
    );
  });
  if (matches.length === 0) throw new Error(`No job matched "${target}"`);
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous job "${target}": ${matches.map((job) => `${job.id} ${job.metadata.company} — ${job.metadata.title}`).join("; ")}`
    );
  }
  return matches[0];
}

function parseOptions(optionArgs) {
  const options = {};
  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    options[key] = optionArgs[index + 1] || "";
    index += 1;
  }
  return options;
}

function requiredArg(value, message) {
  if (!value) throw new Error(message);
  return value;
}

function assertStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Unknown status "${status}". Valid statuses: ${[...VALID_STATUSES].join(", ")}`);
  }
}

function statusRank(status) {
  return STATUS_ORDER[status] ?? 0;
}

function compareJobs(a, b) {
  const statusDiff = statusRank(a.lifecycle.status) - statusRank(b.lifecycle.status);
  if (statusDiff !== 0) return statusDiff;
  const dateA = a.lifecycle.appliedAt || a.lifecycle.packageReadyAt || a.metadata.fetched || "";
  const dateB = b.lifecycle.appliedAt || b.lifecycle.packageReadyAt || b.metadata.fetched || "";
  if (dateA !== dateB) return dateA.localeCompare(dateB);
  return (a.metadata.company || "").localeCompare(b.metadata.company || "");
}

function nextAction(job) {
  if (job.lifecycle.status === "package_ready") return "Apply";
  if (job.lifecycle.status === "needs_action") return "Follow up";
  if (job.lifecycle.status === "interviewing") return "Prepare / schedule";
  if (job.lifecycle.status === "to_review") return "Review fit";
  if (job.lifecycle.status === "to_apply") return job.lifecycle.packagePath ? "Tailor or apply" : "Decide / tailor";
  return "";
}

function applyType(job) {
  if (job.metadata.isEasyApply) return "Easy Apply";
  if (job.metadata.isExternalApply) return "External";
  return "LinkedIn";
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function isClosedOutcome(outcome) {
  return /^(rejected|closed|offer declined|withdrawn|not selected)$/i.test(outcome);
}

function isInterviewOutcome(outcome) {
  return /^(screen|recruiter screen|interview|onsite|final interview)$/i.test(outcome);
}

function isActionRequiredOutcome(outcome) {
  return /^(action required|assessment|take-home|follow up required)$/i.test(outcome);
}

function normalize(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function escapeCell(value = "") {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
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

function printHelp() {
  console.log(`Usage:
  node scripts/job-board.mjs render
  node scripts/job-board.mjs list <status>
  node scripts/job-board.mjs package-ready <job-id|company> --package "<path>" --variant "<variant>"
  node scripts/job-board.mjs applied <job-id|company> [--date YYYY-MM-DD] [--outcome Submitted]
  node scripts/job-board.mjs skip <job-id|company> --reason "..."
  node scripts/job-board.mjs outcome <job-id|company> --outcome "Rejected|Screen|Interview|Offer|Ghosted"
`);
}
