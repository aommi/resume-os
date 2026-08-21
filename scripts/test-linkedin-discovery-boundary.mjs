#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  finalizeDiscoveryBoundary,
  readDiscoveryBoundary,
} from "../engine/linkedin-discovery-boundary.mjs";

const dir = mkdtempSync(join(tmpdir(), "resume-os-discovery-boundary-"));
const path = join(dir, ".linkedin-last-checked");

try {
  assert.equal(readDiscoveryBoundary(path), null);
  assert.deepEqual(finalizeDiscoveryBoundary({
    path,
    expectedMs: null,
    runStartedAtMs: 1_800_000_000_000,
  }), {
    previousMs: null,
    currentMs: 1_800_000_000_000,
  });
  assert.equal(readFileSync(path, "utf8"), "1800000000000\n");

  assert.throws(() => finalizeDiscoveryBoundary({
    path,
    expectedMs: null,
    runStartedAtMs: 1_800_000_001_000,
  }), (error) => error.code === "BOUNDARY_CONFLICT");
  assert.equal(readDiscoveryBoundary(path), 1_800_000_000_000);

  writeFileSync(`${path}.lock`, `${process.pid} ${Date.now()}\n`);
  assert.throws(() => finalizeDiscoveryBoundary({
    path,
    expectedMs: 1_800_000_000_000,
    runStartedAtMs: 1_800_000_001_000,
  }), (error) => error.code === "BOUNDARY_CONFLICT");
  rmSync(`${path}.lock`);
  assert.equal(readDiscoveryBoundary(path), 1_800_000_000_000);

  writeFileSync(`${path}.lock`, `999999 ${Date.now() - 10 * 60 * 1000}\n`);
  assert.deepEqual(finalizeDiscoveryBoundary({
    path,
    expectedMs: 1_800_000_000_000,
    runStartedAtMs: 1_800_000_001_000,
  }), {
    previousMs: 1_800_000_000_000,
    currentMs: 1_800_000_001_000,
  });
  assert.equal(readDiscoveryBoundary(path), 1_800_000_001_000);

  writeFileSync(`${path}.lock`, "");
  const oldLockTime = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(`${path}.lock`, oldLockTime, oldLockTime);
  assert.deepEqual(finalizeDiscoveryBoundary({
    path,
    expectedMs: 1_800_000_001_000,
    runStartedAtMs: 1_800_000_002_000,
  }), {
    previousMs: 1_800_000_001_000,
    currentMs: 1_800_000_002_000,
  });
  assert.equal(readDiscoveryBoundary(path), 1_800_000_002_000);

  assert.throws(() => finalizeDiscoveryBoundary({
    path,
    expectedMs: 1_800_000_002_000,
    runStartedAtMs: 1_799_999_999_999,
  }), /would not advance/);
  assert.equal(readDiscoveryBoundary(path), 1_800_000_002_000);

  writeFileSync(path, "not-a-number\n");
  assert.throws(() => readDiscoveryBoundary(path), /not epoch milliseconds/);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("linkedin discovery boundary tests: PASS");
