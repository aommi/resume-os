#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const profileId = `pipeline-operations-test-${process.pid}`;
const profileDir = join(process.cwd(), "profiles", profileId);
const work = join(profileDir, "work");
const inbox = join(work, "inbox");
const env = { ...process.env, RESUME_OS_PROFILE: profileId };

function run(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), env, encoding: "utf8" });
}

function writeJob(id, metadata, enrichment = true) {
  const dir = join(inbox, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  if (enrichment) writeFileSync(join(dir, "enrichment.md"), "# Fixture\n");
}

try {
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(profileDir, "profile.json"), JSON.stringify({
    profileId,
    jobSearch: { excludedCompanies: ["Excluded Corp"] },
  }) + "\n");

  writeJob("excluded", {
    company: "Excluded Corp",
    title: "Product Manager",
    enrichedAt: "2026-07-27T00:00:00.000Z",
    lifecycle: { status: "to_apply" },
  });
  writeJob("included", {
    company: "Included Corp",
    title: "Product Manager",
    enrichedAt: "2026-07-27T00:00:00.000Z",
    lifecycle: { status: "to_apply" },
  });
  const queue = run("scripts/build-package-queue.mjs");
  assert.equal(queue.status, 0, queue.stderr);
  assert.deepEqual(JSON.parse(queue.stdout).jobs, ["included"]);

  writeJob("scheduled", {
    company: "Example Co",
    title: "Product Manager",
    fetched: "2026-07-27T00:00:00.000Z",
    lifecycle: { status: "applied" },
  });
  const pending = join(work, "events", "pending");
  mkdirSync(pending, { recursive: true });
  writeFileSync(join(pending, "2026-07-27-fixture.md"), `## JOB_EMAIL_EVENT
- job_id: scheduled
- company: Example Co
- role: Product Manager
- event: interview
- event_date: 2026-07-27
- next_event_at: 2099-07-28T17:30:00Z
- subject: Interview invitation
- message_id: fixture-message
- thread_id: fixture-thread
- confidence: high
- evidence: Scheduled interview
- notes: Confirmed by calendar invite
`);
  const imported = run("scripts/import-events.mjs");
  assert.equal(imported.status, 0, imported.stderr);
  const importedMetadata = JSON.parse(readFileSync(join(inbox, "scheduled", "metadata.json"), "utf8"));
  assert.equal(importedMetadata.lifecycle.nextEventAt, "2099-07-28T17:30:00.000Z");
  assert.equal(importedMetadata.lifecycle.status, "interviewing");
  const tracker = readFileSync(join(work, "jobs-tracker.md"), "utf8");
  assert.match(tracker, /## Upcoming Events/);
  assert.match(tracker, /Example Co — Product Manager/);

  writeFileSync(join(pending, "2026-07-27-invalid-event.md"), `## JOB_EMAIL_EVENT
- job_id: scheduled
- company: Example Co
- role: Product Manager
- event: hiring_manager
- event_date: 2026-07-27
- next_event_at: 2099-07-29T10:30:00-07:00
- subject: Hiring manager conversation
- message_id: invalid-time
- thread_id: fixture-thread
- confidence: high
- evidence: Scheduled conversation
- notes: Offset timestamp is intentionally rejected
`);
  const invalidImported = run("scripts/import-events.mjs");
  assert.equal(invalidImported.status, 0, invalidImported.stderr);
  assert.match(invalidImported.stderr, /skipping invalid next_event_at/);
  const invalidMetadata = JSON.parse(readFileSync(join(inbox, "scheduled", "metadata.json"), "utf8"));
  assert.equal(invalidMetadata.lifecycle.nextEventAt, "2099-07-28T17:30:00.000Z");
  assert.equal(invalidMetadata.lifecycle.emailEvents.at(-1).nextEventAt, "");

  const screened = run(
    "scripts/job-board.mjs", "screen", "included",
    "--fit", "build-package", "--priority", "high", "--variant", "pm", "--reason", "Strong JD match",
  );
  assert.equal(screened.status, 0, screened.stderr);
  const screenedMetadata = JSON.parse(readFileSync(join(inbox, "included", "metadata.json"), "utf8"));
  assert.equal(screenedMetadata.lifecycle.status, "to_apply");
  assert.equal(screenedMetadata.lifecycle.fit, "build_package");
  assert.equal(screenedMetadata.lifecycle.priority, "high");
  assert.equal(screenedMetadata.lifecycle.variant, "pm");
  assert.equal(screenedMetadata.lifecycle.screenReason, "Strong JD match");
  assert.equal(screenedMetadata.lifecycle.notes, "");

  const invalidScreen = run("scripts/job-board.mjs", "screen", "included", "--fit", "maybe", "--reason", "Nope");
  assert.notEqual(invalidScreen.status, 0);

  writeFileSync(join(pending, "2026-07-27-rejection.md"), `## JOB_EMAIL_EVENT
- job_id: scheduled
- company: Example Co
- role: Product Manager
- event: rejection
- event_date: 2026-07-27
- subject: Update
- message_id: rejection-message
- thread_id: fixture-thread
- confidence: high
- evidence: Rejected
- notes: Closed
`);
  const rejected = run("scripts/import-events.mjs");
  assert.equal(rejected.status, 0, rejected.stderr);
  const rejectedMetadata = JSON.parse(readFileSync(join(inbox, "scheduled", "metadata.json"), "utf8"));
  assert.equal(rejectedMetadata.lifecycle.nextEventAt, "");
} finally {
  rmSync(profileDir, { recursive: true, force: true });
}

console.log("pipeline operations tests: PASS");
