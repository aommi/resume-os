#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHealthStatus, readHealthStatus, writeHealthStatus } from "../engine/watchdog-health.mjs";

const root = mkdtempSync(join(tmpdir(), "resume-os-watchdog-health-"));
const statusPath = join(root, "nested", "watchdog-health.json");
const checkedAt = new Date("2026-07-27T12:34:56.000Z");

try {
  assert.deepEqual(createHealthStatus([], checkedAt), {
    checkedAt: "2026-07-27T12:34:56.000Z",
    expiresAt: "2026-07-28T00:34:56.000Z",
    healthy: true,
    problems: [],
  });
  assert.deepEqual(writeHealthStatus(statusPath, ["Discovery stale"], checkedAt, 12 * 60 * 60 * 1000), {
    checkedAt: "2026-07-27T12:34:56.000Z",
    expiresAt: "2026-07-28T00:34:56.000Z",
    healthy: false,
    problems: ["Discovery stale"],
  });
  assert.deepEqual(readHealthStatus(statusPath), {
    checkedAt: "2026-07-27T12:34:56.000Z",
    expiresAt: "2026-07-28T00:34:56.000Z",
    healthy: false,
    problems: ["Discovery stale"],
  });

  writeFileSync(statusPath, '{"checkedAt":"not-a-date","expiresAt":"2026-07-28T00:34:56.000Z","healthy":true,"problems":[]}');
  assert.equal(readHealthStatus(statusPath), null);
  writeFileSync(statusPath, '{"checkedAt":"2026-07-27T12:34:56.000Z","expiresAt":"2026-07-28T00:34:56.000Z","healthy":true,"problems":["stale"]}');
  assert.equal(readHealthStatus(statusPath), null);
  writeFileSync(statusPath, '{"checkedAt":"2026-07-27T12:34:56.000Z","expiresAt":"2026-07-27T12:34:56.000Z","healthy":true,"problems":[]}');
  assert.equal(readHealthStatus(statusPath), null);
  writeFileSync(statusPath, "not json");
  assert.equal(readHealthStatus(statusPath), null);
  assert.equal(readHealthStatus(join(root, "missing.json")), null);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("watchdog health tests passed");
