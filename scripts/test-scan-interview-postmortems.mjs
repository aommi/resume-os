#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const profileId = `interview-scan-test-${process.pid}`;
const profile = join(process.cwd(), "profiles", profileId);
const work = join(profile, "work");
const inbox = join(work, "inbox");
const packageDir = join(work, "applications", "Example Co - Product Manager");
const legacyPackageDir = join(work, "applications", "Legacy Co - Product Manager");
const script = "scripts/scan-interview-postmortems.mjs";
const env = { ...process.env, RESUME_OS_PROFILE: profileId };
const eventAt = "2026-08-20T17:30:00.000Z";

try {
  mkdirSync(inbox, { recursive: true });
  mkdirSync(packageDir, { recursive: true });
  mkdirSync(legacyPackageDir, { recursive: true });
  writeFileSync(join(profile, "profile.json"), "{}\n");
  writeJob("with-package", "applications/Example Co - Product Manager", "message-1");
  writeJob("without-package", "", "message-2");
  writeJob("rescheduled", "", "message-3", [
    { messageId: "message-3", event: "recruiter_screen", nextEventAt: eventAt },
    { messageId: "message-4", event: "recruiter_screen", nextEventAt: "2099-08-21T17:30:00.000Z" },
  ]);
  writeJob("rescheduled-after-pending", "", "message-5");

  const baseline = run();
  assert.equal(baseline.status, 0, baseline.stderr);
  let report = readReport();
  assert.equal(report.pending.length, 0, "first run establishes a baseline");

  const backfill = run("--backfill");
  assert.equal(backfill.status, 0, backfill.stderr);
  report = readReport();
  assert.deepEqual(report.pending.map((item) => item.status).sort(), ["awaiting_transcript", "missing_package", "missing_package"]);
  assert.equal(report.pending.some((item) => item.jobId === "rescheduled"), false);

  appendEvent("rescheduled-after-pending", {
    messageId: "message-6",
    event: "recruiter_screen",
    nextEventAt: "2099-08-21T17:30:00.000Z",
  });
  assert.equal(run().status, 0);
  report = readReport();
  assert.equal(report.pending.some((item) => item.jobId === "rescheduled-after-pending"), false);

  setPackagePath("without-package", `profiles/${profileId}/work/applications/Legacy Co - Product Manager`);
  assert.equal(run().status, 0);
  report = readReport();
  assert.equal(report.pending.find((item) => item.jobId === "without-package").status, "awaiting_transcript");

  writeFileSync(join(packageDir, "interview-transcript-2026-08-20-recruiter-screen-sam.md"), "# Notes\n");
  assert.equal(run().status, 0);
  report = readReport();
  assert.equal(report.pending.find((item) => item.jobId === "with-package").status, "awaiting_postmortem");

  writeFileSync(join(packageDir, "interview-postmortem-2026-08-20-recruiter-screen.md"), "# Review\n");
  assert.equal(run().status, 0);
  report = readReport();
  assert.equal(report.pending.some((item) => item.jobId === "with-package"), false);
  assert.equal(report.pending.find((item) => item.jobId === "without-package").status, "awaiting_transcript");
} finally {
  rmSync(profile, { recursive: true, force: true });
}

console.log("interview postmortem scanner tests: PASS");

function writeJob(id, packagePath, messageId, emailEvents = [{ messageId, event: "recruiter_screen", nextEventAt: eventAt }]) {
  const directory = join(inbox, id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "metadata.json"), JSON.stringify({
    company: "Example Co",
    title: "Product Manager",
    lifecycle: {
      packagePath,
      emailEvents,
    },
  }, null, 2));
}

function setPackagePath(id, packagePath) {
  const path = join(inbox, id, "metadata.json");
  const metadata = JSON.parse(readFileSync(path, "utf8"));
  metadata.lifecycle.packagePath = packagePath;
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

function appendEvent(id, event) {
  const path = join(inbox, id, "metadata.json");
  const metadata = JSON.parse(readFileSync(path, "utf8"));
  metadata.lifecycle.emailEvents.push(event);
  writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
}

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: process.cwd(), env, encoding: "utf8" });
}

function readReport() {
  const path = join(work, "runtime", "interview-postmortem-scan.json");
  assert.equal(existsSync(path), true);
  return JSON.parse(readFileSync(path, "utf8"));
}
