#!/usr/bin/env node
// Read-only follow-up detector for completed, explicitly scheduled interview events.
// It never decides whether a call occurred or evaluates an interview; it only keeps a
// profile-local queue for the interview-postmortem judgment workflow.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { workDir } from "../engine/config.mjs";

const WORK = workDir();
const INBOX = join(WORK, "inbox");
const RUNTIME = join(WORK, "runtime");
const STATE_PATH = join(RUNTIME, "interview-postmortem-scan.json");
const INTERVIEW_EVENTS = new Set(["interview", "recruiter_screen", "hiring_manager"]);
const args = new Set(process.argv.slice(2));
const backfill = args.has("--backfill");
const dryRun = args.has("--dry-run");

try {
  const result = scan({ now: new Date(), backfill, dryRun });
  console.log(JSON.stringify(result.summary, null, 2));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}

export function scan({ now = new Date(), backfill = false, dryRun = false } = {}) {
  const nowIso = now.toISOString();
  const previous = loadState();
  const firstRun = !previous;
  const jobs = loadJobs();
  const latestByJobStage = latestScheduledByJobStage(jobs);
  const completed = collectCompletedEvents(jobs, nowIso, latestByJobStage);
  const priorPending = new Map((previous?.pending || []).map((item) => [item.key, item]));
  const candidates = new Map();
  let superseded = 0;

  for (const event of priorPending.values()) {
    if (latestByJobStage.get(jobStageKey(event.jobId, event.stage)) === event.nextEventAt) {
      candidates.set(event.key, event);
    } else {
      superseded += 1;
    }
  }

  for (const event of completed) {
    // Pending items are re-read from current metadata on every run. This lets
    // a package linked after an explicit backfill resolve without another one.
    if (priorPending.has(event.key) || backfill || !firstRun && event.nextEventAt > previous.initializedAt) {
      candidates.set(event.key, event);
    }
  }

  const pending = [];
  let resolved = 0;
  for (const event of candidates.values()) {
    const assessment = assess(event);
    if (assessment.status === "complete") {
      resolved += 1;
      continue;
    }
    pending.push(assessment);
  }
  pending.sort((a, b) => a.nextEventAt.localeCompare(b.nextEventAt));

  const state = {
    version: 1,
    initializedAt: previous?.initializedAt || nowIso,
    lastScannedAt: nowIso,
    pending,
  };
  const summary = {
    workflow: "interview-postmortem-scan",
    firstRun,
    backfill,
    scannedCompletedEvents: completed.length,
    newlyConsidered: [...candidates.keys()].filter((key) => !priorPending.has(key)).length,
    resolved,
    superseded,
    pending: pending.length,
    report: STATE_PATH,
  };

  if (!dryRun) {
    mkdirSync(RUNTIME, { recursive: true });
    writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  }
  return { state, summary };
}

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    const value = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    if (!value || value.version !== 1 || !isTimestamp(value.initializedAt) || !Array.isArray(value.pending)) {
      throw new Error("unsupported state format");
    }
    return value;
  } catch (error) {
    throw new Error(`cannot read ${STATE_PATH}: ${error.message}`);
  }
}

function loadJobs() {
  if (!existsSync(INBOX)) return [];
  const jobs = [];
  for (const name of readdirSync(INBOX)) {
    const directory = join(INBOX, name);
    const path = join(directory, "metadata.json");
    if (!isDirectory(directory) || !existsSync(path)) continue;
    try {
      jobs.push({ id: name, metadata: JSON.parse(readFileSync(path, "utf8")) });
    } catch {
      console.error(`skipping unreadable metadata: ${path}`);
    }
  }
  return jobs;
}

function collectCompletedEvents(jobs, nowIso, latestByJobStage) {
  const events = [];
  for (const job of jobs) {
    const lifecycle = job.metadata.lifecycle || {};
    for (const emailEvent of lifecycle.emailEvents || []) {
      const eventName = String(emailEvent.event || "").toLowerCase();
      const nextEventAt = String(emailEvent.nextEventAt || "");
      if (!INTERVIEW_EVENTS.has(eventName) || !isTimestamp(nextEventAt) || nextEventAt > nowIso) continue;
      // A later event at the same stage is treated as a reschedule. The event
      // record is append-only, so the earlier invitation is not deleted.
      if (latestByJobStage.get(jobStageKey(job.id, stageName(eventName))) !== nextEventAt) continue;
      const key = `${job.id}:${emailEvent.messageId || "no-message-id"}:${nextEventAt}`;
      events.push({
        key,
        jobId: job.id,
        company: String(job.metadata.company || ""),
        title: String(job.metadata.title || ""),
        stage: stageName(eventName),
        nextEventAt,
        packagePath: String(lifecycle.packagePath || ""),
      });
    }
  }
  return events;
}

function latestScheduledByJobStage(jobs) {
  const latest = new Map();
  for (const job of jobs) {
    for (const event of job.metadata.lifecycle?.emailEvents || []) {
      const stage = String(event.event || "").toLowerCase();
      const at = String(event.nextEventAt || "");
      const key = jobStageKey(job.id, stageName(stage));
      if (!INTERVIEW_EVENTS.has(stage) || !isTimestamp(at) || at <= (latest.get(key) || "")) continue;
      latest.set(key, at);
    }
  }
  return latest;
}

function stageName(value) {
  return String(value || "").replace(/_/g, "-");
}

function jobStageKey(jobId, stage) {
  return `${jobId}:${stageName(stage)}`;
}

function assess(event) {
  const packageDir = resolvePackagePath(event.packagePath);
  if (!packageDir || !isDirectory(packageDir)) {
    return { ...event, status: "missing_package" };
  }
  const day = event.nextEventAt.slice(0, 10);
  const files = listFiles(packageDir);
  const transcript = files.find((path) => basename(path).startsWith(`interview-transcript-${day}-`));
  const postmortem = files.find((path) => basename(path).startsWith(`interview-postmortem-${day}-`));
  if (postmortem) return { ...event, status: "complete" };
  if (transcript) {
    return { ...event, status: "awaiting_postmortem", transcript: toWorkRelative(transcript) };
  }
  return { ...event, status: "awaiting_transcript" };
}

function resolvePackagePath(value) {
  if (!value) return "";
  if (isAbsolute(value)) return resolve(value);
  const workRelative = resolve(WORK, value);
  if (!relative(WORK, workRelative).startsWith("..") && existsSync(workRelative)) return workRelative;
  // Some pre-profile-migration metadata stored a repo-relative profile path.
  // Preserve that readable legacy form without accepting traversal from WORK.
  if (value.startsWith("profiles/")) {
    const repoRelative = resolve(process.cwd(), value);
    if (existsSync(repoRelative)) return repoRelative;
  }
  return !relative(WORK, workRelative).startsWith("..") ? workRelative : "";
}

function toWorkRelative(path) {
  const value = relative(WORK, path);
  return value && !value.startsWith("..") ? value : path;
}

function listFiles(directory) {
  const files = [];
  const stack = [directory];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      if (name.startsWith(".")) continue;
      const path = join(current, name);
      if (isDirectory(path)) stack.push(path);
      else files.push(path);
    }
  }
  return files;
}

function basename(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isTimestamp(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(new Date(value).getTime());
}
