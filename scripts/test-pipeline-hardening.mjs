#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const profileId = `pipeline-hardening-test-${process.pid}`;
const profileDir = join(process.cwd(), "profiles", profileId);
const workDir = join(profileDir, "work");
const inboxDir = join(workDir, "inbox");
const env = { ...process.env, RESUME_OS_PROFILE: profileId };

function run(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

try {
  mkdirSync(join(inboxDir, "broken"), { recursive: true });
  writeFileSync(join(inboxDir, "broken", "metadata.json"), "{not-json\n");
  writeFileSync(join(inboxDir, "broken", "enrichment.md"), "# Broken fixture\n");

  const packagedDir = join(workDir, "applications", "Example Co - Product Manager");
  mkdirSync(packagedDir, { recursive: true });
  const validDir = join(inboxDir, "valid");
  mkdirSync(validDir, { recursive: true });
  writeFileSync(join(validDir, "metadata.json"), JSON.stringify({
    company: "Example Co",
    title: "Product Manager",
    enrichedAt: "2026-07-18T00:00:00.000Z",
    lifecycle: {
      status: "to_apply",
      packagePath: "applications/Example Co - Product Manager",
    },
  }, null, 2) + "\n");
  writeFileSync(join(validDir, "enrichment.md"), "# Valid fixture\n");

  const board = run("scripts/job-board.mjs", "list", "to_apply");
  assert.equal(board.status, 0, board.stderr);
  assert.match(board.stdout, /Example Co/);
  assert.match(board.stderr, /skipping unreadable metadata: .*broken\/metadata\.json/);

  const queue = run("scripts/build-package-queue.mjs");
  assert.equal(queue.status, 0, queue.stderr);
  assert.equal(JSON.parse(queue.stdout).queued, 0);
  assert.match(queue.stderr, /skipping unreadable metadata: .*broken\/metadata\.json/);
  assert.match(readFileSync(join(workDir, "package-queue.md"), "utf8"), /0 jobs/);
} finally {
  rmSync(profileDir, { recursive: true, force: true });
}

console.log("pipeline hardening tests: PASS");
