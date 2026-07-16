#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { timezone, workDir } from "../engine/config.mjs";
import { readLinkedInLock } from "../engine/linkedin-lock.mjs";

const CADENCE_MINUTES = 5;
const DAILY_CAP = 5;
const MAX_ATTEMPTS = 3;
const MAX_AGE_DAYS = 14;
const STALE_RUNNING_MS = 10 * 60 * 1000;
const VALID_LEVELS = new Set(["top_applicant", "high", "medium", "low"]);

export async function runWorker({
  work = workDir(),
  now = new Date(),
  spawnAssessment = runAssessmentProcess,
} = {}) {
  const runId = randomUUID();
  const heartbeat = (outcome, failureCategory = "") => writeHeartbeat(work, {
    workflow: "linkedin-assessment",
    cadenceMinutes: CADENCE_MINUTES,
    lastAttempt: now.toISOString(),
    lastSuccess: now.toISOString(),
    exitCode: 0,
    failureCategory,
    runId,
    model: "none",
    outcome,
  });

  if (existsSync(join(work, "linkedin-stop.json"))) {
    heartbeat("skipped_stop_state");
    return { outcome: "skipped_stop_state" };
  }

  const heldLock = readLinkedInLock(work);
  if (heldLock) {
    heartbeat("skipped_lock_held");
    return { outcome: "skipped_lock_held", workflow: heldLock.workflow || "unknown" };
  }

  const jobs = loadJobs(work);
  for (const job of jobs) {
    const reclaimed = reclaimStaleRunning(job.metadata.linkedinAssessment, now);
    if (reclaimed) {
      job.metadata = mergeAssessmentMetadata(job.metadataPath, reclaimed);
    }
  }

  if (countTodayAttempts(jobs, now, timezone()) >= DAILY_CAP) {
    heartbeat("skipped_daily_cap");
    return { outcome: "skipped_daily_cap" };
  }

  const job = selectEligibleJob(jobs, now);
  if (!job) {
    heartbeat("no_eligible_jobs");
    return { outcome: "no_eligible_jobs" };
  }

  const previous = job.metadata.linkedinAssessment;
  const running = {
    ...(previous || {}),
    status: "running",
    attempts: Number(previous.attempts || 0) + 1,
    lastAttemptAt: now.toISOString(),
    startedAt: now.toISOString(),
    completedAt: null,
    jobMatchLevel: null,
    requiredQualifications: null,
    failureCategory: "",
    evidenceText: "",
  };
  mergeAssessmentMetadata(job.metadataPath, running);

  let result;
  try {
    result = await spawnAssessment(job, work);
  } catch (error) {
    mergeAssessmentMetadata(job.metadataPath, failedAssessment(running, now, "chrome_unavailable", error.message));
    throw error;
  }

  if (result?.authChallenge || result?.failureCategory === "auth_challenge") {
    ensureStopFile(work, result, now);
    mergeAssessmentMetadata(job.metadataPath, failedAssessment(running, now, "auth_challenge", result.pageTitle || ""));
    heartbeat("job_failed", "auth_challenge");
    return { outcome: "job_failed", jobId: job.id, failureCategory: "auth_challenge" };
  }

  if (result?.skipped) {
    mergeAssessmentMetadata(job.metadataPath, previous);
    heartbeat("skipped_lock_held");
    return { outcome: "skipped_lock_held", jobId: job.id };
  }

  if (!isValidAssessmentResult(result)) {
    const category = "assessment_incomplete";
    mergeAssessmentMetadata(
      job.metadataPath,
      failedAssessment(running, now, category, result?.diagnostics?.renderedMatchText || result?.raw || ""),
    );
    heartbeat("job_failed", category);
    return { outcome: "job_failed", jobId: job.id, failureCategory: category };
  }

  const succeeded = {
    ...running,
    status: "succeeded",
    completedAt: now.toISOString(),
    jobMatchLevel: result.jobMatchLevel,
    requiredQualifications: result.requiredQualifications,
    failureCategory: "",
    evidenceText: truncate(result.diagnostics?.renderedMatchText || result.topApplicantSignal?.text || ""),
    reassess: false,
  };
  mergeAssessmentMetadata(job.metadataPath, succeeded);
  heartbeat("succeeded");
  return { outcome: "succeeded", jobId: job.id, jobMatchLevel: result.jobMatchLevel };
}

export function isEligibleJob(job, now = new Date()) {
  const metadata = job.metadata || job;
  if (!["to_review", "to_apply"].includes(metadata.lifecycle?.status)) return false;
  const assessment = metadata.linkedinAssessment || {};
  if (assessment.status === "succeeded" && assessment.reassess !== true) return false;
  if (assessment.status === "running") return false;
  if (Number(assessment.attempts || 0) >= MAX_ATTEMPTS) return false;
  const date = metadata.postedAt || metadata.fetched;
  return Boolean(date) && ageInDays(date, now) <= MAX_AGE_DAYS;
}

export function selectEligibleJob(jobs, now = new Date()) {
  return jobs
    .filter((job) => isEligibleJob(job, now))
    .sort((a, b) => {
      const aManual = a.metadata.linkedinAssessment?.reassess === true ? 1 : 0;
      const bManual = b.metadata.linkedinAssessment?.reassess === true ? 1 : 0;
      if (aManual !== bManual) return bManual - aManual;
      const aDate = a.metadata.postedAt || a.metadata.fetched || "";
      const bDate = b.metadata.postedAt || b.metadata.fetched || "";
      if (aDate !== bDate) return bDate.localeCompare(aDate);
      return String(b.metadata.fetched || "").localeCompare(String(a.metadata.fetched || ""));
    })[0] || null;
}

export function reclaimStaleRunning(assessment, now = new Date()) {
  if (assessment?.status !== "running") return null;
  const started = new Date(assessment.startedAt || 0).getTime();
  if (Number.isFinite(started) && now.getTime() - started <= STALE_RUNNING_MS) return null;
  return failedAssessment(assessment, now, "stale_running", "Previous assessment did not complete.");
}

export function mergeAssessmentMetadata(metadataPath, assessment) {
  const latest = JSON.parse(readFileSync(metadataPath, "utf8"));
  const merged = { ...latest };
  if (assessment === undefined) delete merged.linkedinAssessment;
  else merged.linkedinAssessment = assessment;
  writeJsonAtomic(metadataPath, merged);
  return merged;
}

export function isValidAssessmentResult(result) {
  if (!VALID_LEVELS.has(result?.jobMatchLevel)) return false;
  const matched = result?.requiredQualifications?.matched;
  const total = result?.requiredQualifications?.total;
  return Number.isInteger(matched) && Number.isInteger(total) && matched >= 1 && matched <= total;
}

function loadJobs(work) {
  const inbox = join(work, "inbox");
  if (!existsSync(inbox) || !statSync(inbox).isDirectory()) {
    throw new Error(`Inbox directory is unavailable: ${inbox}`);
  }
  return readdirSync(inbox, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const metadataPath = join(inbox, entry.name, "metadata.json");
      if (!existsSync(metadataPath)) return null;
      return {
        id: entry.name,
        metadataPath,
        metadata: JSON.parse(readFileSync(metadataPath, "utf8")),
      };
    })
    .filter(Boolean);
}

function countTodayAttempts(jobs, now, timeZone) {
  const today = localDate(now, timeZone);
  return jobs.filter((job) => {
    const value = job.metadata.linkedinAssessment?.lastAttemptAt;
    return value && localDate(new Date(value), timeZone) === today;
  }).length;
}

function ageInDays(dateText, now) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return Infinity;
  return Math.max(0, Math.floor((today - date) / 86_400_000));
}

function localDate(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function failedAssessment(previous, now, failureCategory, evidenceText = "") {
  return {
    ...previous,
    status: "failed",
    completedAt: now.toISOString(),
    failureCategory,
    evidenceText: truncate(evidenceText),
  };
}

function truncate(value) {
  return String(value || "").slice(0, 2_000);
}

function ensureStopFile(work, result, now) {
  const path = join(work, "linkedin-stop.json");
  if (existsSync(path)) return;
  writeJsonAtomic(path, {
    reason: "auth_challenge",
    url: result.challengeUrl || result.url || "",
    detectedAt: now.toISOString(),
    workflow: "linkedin-assessment",
  });
}

async function runAssessmentProcess(job) {
  const script = join(process.cwd(), "scripts", "process-job.mjs");
  const child = spawnSync(process.execPath, [
    script,
    job.metadata.url,
    "--assess-match",
    "--signals-only",
    "--workflow",
    "linkedin-assessment",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (child.error || child.status !== 0) {
    throw new Error(child.error?.message || child.stderr?.trim() || `process-job exited ${child.status}`);
  }
  const output = child.stdout.trim();
  if (output.startsWith("skipped: lock held by")) return { skipped: true, raw: output };
  try {
    return JSON.parse(output);
  } catch {
    return { raw: output };
  }
}

function writeHeartbeat(work, value) {
  writeJsonAtomic(join(work, "heartbeats", "linkedin-assessment.json"), value);
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tempPath, JSON.stringify(value, null, 2) + "\n");
  renameSync(tempPath, path);
}

async function main() {
  const work = workDir();
  const now = new Date();
  try {
    const result = await runWorker({ work, now });
    console.log(JSON.stringify(result));
  } catch (error) {
    try {
      writeHeartbeat(work, {
        workflow: "linkedin-assessment",
        cadenceMinutes: CADENCE_MINUTES,
        lastAttempt: now.toISOString(),
        lastSuccess: null,
        exitCode: 1,
        failureCategory: "workflow_failure",
        runId: randomUUID(),
        model: "none",
        outcome: "failed",
      });
    } catch {}
    console.error(`assessment worker failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
