#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function runDailyBrief(envOverrides) {
  return spawnSync("bash", ["scripts/run-daily-brief.sh"], {
    cwd: process.cwd(),
    env: { ...env, ...envOverrides },
    encoding: "utf8",
  });
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

  const hermesBin = join(profileDir, "bin");
  const hermesCalls = join(profileDir, "hermes-calls.log");
  const briefLog = join(profileDir, "daily-brief.log");
  mkdirSync(hermesBin, { recursive: true });
  writeFileSync(join(hermesBin, "hermes"), `#!/usr/bin/env bash
printf '%s\\n' "$1" >> "$HERMES_CALLS"
if [ "$1" = "chat" ]; then
  printf 'Action brief\\n'
else
  cat >/dev/null
fi
`);
  chmodSync(join(hermesBin, "hermes"), 0o755);
  const briefEnv = {
    BRIEF_SEND_TARGET: "telegram:test",
    HERMES_CALLS: hermesCalls,
    RESUME_OS_BRIEF_LOG: briefLog,
    PATH: `${hermesBin}:${process.env.PATH}`,
  };
  function assertActionableBrief() {
    rmSync(hermesCalls, { force: true });
    const brief = runDailyBrief(briefEnv);
    assert.equal(brief.status, 0, brief.stderr);
    assert.deepEqual(readFileSync(hermesCalls, "utf8").trim().split("\n"), ["chat", "send"]);
  }

  const quietRender = run("scripts/job-board.mjs", "render");
  assert.equal(quietRender.status, 0, quietRender.stderr);
  const quietBrief = runDailyBrief(briefEnv);
  assert.equal(quietBrief.status, 0, quietBrief.stderr);
  assert.equal(existsSync(hermesCalls), false);
  const quietHeartbeat = JSON.parse(readFileSync(join(work, "heartbeats", "daily-brief.json"), "utf8"));
  assert.equal(quietHeartbeat.exitCode, 0);
  assert.equal(quietHeartbeat.failureCategory, "");

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
    description: "A complete product management job description.",
    lifecycle: { status: "to_apply" },
  });
  writeJob("base-only", {
    company: "Base Only Corp",
    title: "Product Manager",
    enrichedAt: "2026-07-27T00:00:00.000Z",
    lifecycle: { status: "to_apply", pursue: "apply", strategy: "base_resume" },
  });
  const queue = run("scripts/build-package-queue.mjs");
  assert.equal(queue.status, 0, queue.stderr);
  assert.deepEqual(JSON.parse(queue.stdout).jobs, []);

  writeJob("upcoming-only", {
    company: "Upcoming Co",
    title: "Product Manager",
    fetched: "2026-07-27T00:00:00.000Z",
    lifecycle: { status: "applied", nextEventAt: "2099-07-28T17:30:00.000Z" },
  }, false);
  assert.equal(run("scripts/job-board.mjs", "render").status, 0);
  assertActionableBrief();
  rmSync(join(inbox, "upcoming-only"), { recursive: true });

  writeJob("needs-action-only", {
    company: "Action Co",
    title: "Product Manager",
    fetched: "2026-07-27T00:00:00.000Z",
    lifecycle: { status: "needs_action" },
  }, false);
  assert.equal(run("scripts/job-board.mjs", "render").status, 0);
  assertActionableBrief();
  rmSync(join(inbox, "needs-action-only"), { recursive: true });

  writeJob("interviewing-only", {
    company: "Interview Co",
    title: "Product Manager",
    fetched: "2026-07-27T00:00:00.000Z",
    lifecycle: { status: "interviewing" },
  }, false);
  assert.equal(run("scripts/job-board.mjs", "render").status, 0);
  assertActionableBrief();
  rmSync(join(inbox, "interviewing-only"), { recursive: true });

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
    "--pursue", "apply", "--strategy", "tailor", "--application-mode", "focused", "--priority", "high", "--variant", "pm", "--reason", "Strong JD match",
  );
  assert.equal(screened.status, 0, screened.stderr);
  const screenedMetadata = JSON.parse(readFileSync(join(inbox, "included", "metadata.json"), "utf8"));
  assert.equal(screenedMetadata.lifecycle.status, "to_apply");
  assert.equal(screenedMetadata.lifecycle.pursue, "apply");
  assert.equal(screenedMetadata.lifecycle.strategy, "tailor");
  assert.equal(screenedMetadata.lifecycle.applicationMode, "focused");
  assert.equal(screenedMetadata.lifecycle.priority, "high");
  assert.equal(screenedMetadata.lifecycle.variant, "pm");
  assert.equal(screenedMetadata.lifecycle.screenReason, "Strong JD match");
  assert.equal(screenedMetadata.lifecycle.notes, "");
  const beforeApprovalQueue = run("scripts/job-board.mjs", "list", "to_apply");
  assert.equal(beforeApprovalQueue.status, 0, beforeApprovalQueue.stderr);
  const emptyTailorQueue = run("scripts/build-package-queue.mjs");
  assert.deepEqual(JSON.parse(emptyTailorQueue.stdout).jobs, []);
  const approveTailor = run("scripts/job-board.mjs", "approve-tailor", "included");
  assert.equal(approveTailor.status, 0, approveTailor.stderr);
  const approvedTailorQueue = run("scripts/build-package-queue.mjs");
  assert.deepEqual(JSON.parse(approvedTailorQueue.stdout).jobs, ["included"]);
  const rescreenTailor = run("scripts/job-board.mjs", "screen", "included", "--pursue", "apply", "--strategy", "tailor", "--reason", "Updated reasoning");
  assert.equal(rescreenTailor.status, 0, rescreenTailor.stderr);
  const reapprovalRequiredQueue = run("scripts/build-package-queue.mjs");
  assert.deepEqual(JSON.parse(reapprovalRequiredQueue.stdout).jobs, []);

  const invalidOpportunistic = run(
    "scripts/job-board.mjs", "screen", "included",
    "--pursue", "apply", "--strategy", "tailor", "--application-mode", "opportunistic", "--reason", "Invalid mode",
  );
  assert.notEqual(invalidOpportunistic.status, 0);

  const opportunistic = run(
    "scripts/job-board.mjs", "screen", "included",
    "--pursue", "apply", "--strategy", "base_resume", "--application-mode", "opportunistic", "--reason", "Eligible long shot",
  );
  assert.equal(opportunistic.status, 0, opportunistic.stderr);
  const opportunisticMetadata = JSON.parse(readFileSync(join(inbox, "included", "metadata.json"), "utf8"));
  assert.equal(opportunisticMetadata.lifecycle.applicationMode, "opportunistic");
  assert.equal(opportunisticMetadata.lifecycle.strategy, "base_resume");

  const needsInput = run(
    "scripts/job-board.mjs", "screen", "included",
    "--pursue", "needs_input", "--reason", "Location missing", "--question", "Would you commute to Burnaby?",
  );
  assert.equal(needsInput.status, 0, needsInput.stderr);
  const needsInputMetadata = JSON.parse(readFileSync(join(inbox, "included", "metadata.json"), "utf8"));
  assert.equal(needsInputMetadata.lifecycle.status, "to_review");
  assert.equal(needsInputMetadata.lifecycle.pursue, "needs_input");
  assert.equal(needsInputMetadata.lifecycle.strategy, "");
  assert.equal(needsInputMetadata.lifecycle.applicationMode, "");
  assert.equal(needsInputMetadata.lifecycle.notes, "");
  assert.equal(needsInputMetadata.lifecycle.screenQuestion, "Would you commute to Burnaby?");

  const invalidScreen = run("scripts/job-board.mjs", "screen", "included", "--pursue", "apply", "--reason", "No strategy");
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
