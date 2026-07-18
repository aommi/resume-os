#!/usr/bin/env node

import assert from "node:assert/strict";
import { isCompanyExcluded, normalizeCompanyName } from "../engine/job-exclusions.mjs";

const profile = { jobSearch: { excludedCompanies: ["Jobgether"] } };

assert.equal(normalizeCompanyName("  JOBGETHER! "), "jobgether");
assert.equal(isCompanyExcluded("Jobgether", profile), true);
assert.equal(isCompanyExcluded(" jobgether ", profile), true);
assert.equal(isCompanyExcluded("Jobgether Labs", profile), false);
assert.equal(isCompanyExcluded("Real Employer", profile), false);
assert.equal(isCompanyExcluded("Jobgether", { jobSearch: { excludedCompanies: "Jobgether" } }), false);

console.log("job exclusion tests: PASS");
