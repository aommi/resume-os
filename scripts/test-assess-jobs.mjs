#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isEligibleJob,
  mergeAssessmentMetadata,
  reclaimStaleRunning,
  runWorker,
  selectEligibleJob,
} from "./assess-jobs.mjs";

const now = new Date("2026-07-16T12:00:00.000Z");

function job(id, overrides = {}) {
  return {
    id,
    metadata: {
      url: `https://www.linkedin.com/jobs/view/${id}/`,
      postedAt: "2026-07-15",
      fetched: "2026-07-16",
      lifecycle: { status: "to_apply" },
      ...overrides,
    },
  };
}

assert.equal(isEligibleJob(job("1"), now), true);
assert.equal(isEligibleJob(job("2", { postedAt: "2026-06-01" }), now), false);
assert.equal(isEligibleJob(job("3", { postedAt: "", fetched: "2026-07-10" }), now), true);
assert.equal(isEligibleJob(job("4", { lifecycle: { status: "applied" } }), now), false);
assert.equal(isEligibleJob(job("5", {
  linkedinAssessment: { status: "succeeded", attempts: 1 },
}), now), false);
assert.equal(isEligibleJob(job("6", {
  linkedinAssessment: { status: "succeeded", attempts: 1, reassess: true },
}), now), true);

const selectedManual = selectEligibleJob([
  job("new", { postedAt: "2026-07-16" }),
  job("manual", {
    postedAt: "2026-07-10",
    linkedinAssessment: { status: "succeeded", attempts: 1, reassess: true },
  }),
], now);
assert.equal(selectedManual.id, "manual");

const selectedNewest = selectEligibleJob([
  job("older", { postedAt: "2026-07-12" }),
  job("newer", { postedAt: "2026-07-15" }),
], now);
assert.equal(selectedNewest.id, "newer");

assert.equal(reclaimStaleRunning({
  status: "running",
  attempts: 1,
  startedAt: "2026-07-16T11:55:00.000Z",
}, now), null);
assert.equal(reclaimStaleRunning({
  status: "running",
  attempts: 1,
  startedAt: "2026-07-16T11:40:00.000Z",
}, now).failureCategory, "stale_running");

const root = mkdtempSync(join(tmpdir(), "resume-os-assess-test-"));
try {
  const inbox = join(root, "inbox");
  const jobDir = join(inbox, "100");
  mkdirSync(jobDir, { recursive: true });
  const metadataPath = join(jobDir, "metadata.json");
  writeFileSync(metadataPath, JSON.stringify({
    url: "https://www.linkedin.com/jobs/view/100/",
    source: { preserved: true },
    enrichedAt: "2026-07-16T00:00:00.000Z",
    postedAt: "2026-07-15",
    fetched: "2026-07-16",
    lifecycle: { status: "to_apply", notes: "keep" },
  }));
  const merged = mergeAssessmentMetadata(metadataPath, { status: "running", attempts: 1 });
  assert.deepEqual(merged.source, { preserved: true });
  assert.equal(merged.enrichedAt, "2026-07-16T00:00:00.000Z");
  assert.equal(merged.lifecycle.notes, "keep");

  writeFileSync(join(root, "linkedin-stop.json"), JSON.stringify({ reason: "auth_challenge" }));
  let spawned = false;
  const stopped = await runWorker({
    work: root,
    now,
    spawnAssessment: async () => { spawned = true; },
  });
  assert.equal(stopped.outcome, "skipped_stop_state");
  assert.equal(spawned, false);
  const heartbeatPath = join(root, "heartbeats", "linkedin-assessment.json");
  assert.equal(existsSync(heartbeatPath), true);
  const heartbeat = JSON.parse(readFileSync(heartbeatPath, "utf8"));
  assert.equal(heartbeat.exitCode, 0);
  assert.equal(heartbeat.outcome, "skipped_stop_state");

  rmSync(join(root, "linkedin-stop.json"));
  const failed = await runWorker({
    work: root,
    now,
    spawnAssessment: async () => ({ jobMatchLevel: null }),
  });
  assert.equal(failed.outcome, "job_failed");
  const failureHeartbeat = JSON.parse(readFileSync(heartbeatPath, "utf8"));
  assert.equal(failureHeartbeat.exitCode, 0, "a per-job failure must not fail the workflow heartbeat");
  assert.equal(failureHeartbeat.failureCategory, "assessment_incomplete");

  const beforeCollision = JSON.parse(readFileSync(metadataPath, "utf8")).linkedinAssessment;
  const collision = await runWorker({
    work: root,
    now,
    spawnAssessment: async () => ({ skipped: true, raw: "skipped: lock held by linkedin-discovery" }),
  });
  assert.equal(collision.outcome, "skipped_lock_held");
  const afterCollision = JSON.parse(readFileSync(metadataPath, "utf8")).linkedinAssessment;
  assert.deepEqual(afterCollision, beforeCollision, "a lock collision must not consume an attempt");
  const collisionHeartbeat = JSON.parse(readFileSync(heartbeatPath, "utf8"));
  assert.equal(collisionHeartbeat.exitCode, 0);
  assert.equal(collisionHeartbeat.outcome, "skipped_lock_held");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("assessment worker tests: PASS");
