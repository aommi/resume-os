#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLinkedInLock, readLinkedInLock } from "../engine/linkedin-lock.mjs";

const work = mkdtempSync(join(tmpdir(), "resume-os-linkedin-lock-test-"));
try {
  const first = acquireLinkedInLock("first", { work });
  assert.equal(first.acquired, true);
  assert.equal(readLinkedInLock(work).workflow, "first");

  const second = acquireLinkedInLock("second", { work });
  assert.equal(second.acquired, false);
  assert.equal(second.holder.workflow, "first");

  first.release();
  assert.equal(readLinkedInLock(work), null);

  const third = acquireLinkedInLock("third", { work });
  assert.equal(third.acquired, true);
  third.release();
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("linkedin lock tests: PASS");
