#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  parseProcessJobArgs,
  shouldAttemptLinkedInSave,
} from "../engine/process-job-options.mjs";

const inspection = parseProcessJobArgs([
  "https://www.linkedin.com/jobs/view/123/",
  "--out", "/tmp/staging",
  "--no-save",
  "--workflow", "job-search-sweep",
]);
assert.equal(inspection.url, "https://www.linkedin.com/jobs/view/123/");
assert.equal(inspection.out, "/tmp/staging");
assert.equal(inspection.noSave, true);
assert.equal(inspection.workflow, "job-search-sweep");
assert.equal(shouldAttemptLinkedInSave(inspection), false);

const ordinary = parseProcessJobArgs(["https://www.linkedin.com/jobs/view/456/"]);
assert.equal(ordinary.noSave, false);
assert.equal(shouldAttemptLinkedInSave(ordinary), true);

console.log("process job option tests: PASS");
