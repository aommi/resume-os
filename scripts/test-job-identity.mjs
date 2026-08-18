#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  extractEmployerRequisition,
  extractLinkedInJobId,
  findExactJobDuplicate,
  resolveJobIdentity,
} from "../engine/job-identity.mjs";
import { assessScreenability } from "../engine/job-screenability.mjs";

assert.equal(extractLinkedInJobId("https://www.linkedin.com/jobs/view/4455274666/?trackingId=x"), "4455274666");
assert.equal(extractLinkedInJobId("https://www.linkedin.com/jobs/view/senior-product-manager-4455274666"), "4455274666");

assert.deepEqual(
  extractEmployerRequisition("https://job-boards.greenhouse.io/remotecom/jobs/7885156003"),
  { employerRequisitionId: "7885156003", employerRequisitionSource: "greenhouse:remotecom" },
);
assert.deepEqual(
  extractEmployerRequisition("https://autodesk.wd1.myworkdayjobs.com/Ext/job/Toronto/Senior-Product-Manager_25WD12345"),
  { employerRequisitionId: "25WD12345", employerRequisitionSource: "workday:autodesk" },
);

const jobs = [
  job("old-linkedin", {
    url: "https://www.linkedin.com/jobs/view/4455274666/",
    fetched: "2026-08-14",
    lifecycle: { status: "applied", appliedAt: "2026-08-14" },
  }),
  job("old-requisition", {
    url: "https://www.linkedin.com/jobs/view/4000000001/",
    applyUrl: "https://job-boards.greenhouse.io/remotecom/jobs/7813609003",
    company: "Remote",
    fetched: "2026-08-10",
  }),
];

let duplicate = findExactJobDuplicate(job("incoming", {
  url: "https://www.linkedin.com/jobs/view/same-title-4455274666?trk=foo",
  fetched: "2026-08-17",
}), jobs);
assert.equal(duplicate?.job.id, "old-linkedin");
assert.equal(duplicate?.basis, "LinkedIn job ID");

duplicate = findExactJobDuplicate(job("repost", {
  url: "https://www.linkedin.com/jobs/view/4999999999/",
  applyUrl: "https://job-boards.greenhouse.io/remotecom/jobs/7813609003",
  company: "Remote",
  fetched: "2026-08-17",
}), jobs);
assert.equal(duplicate, null, "a newer unapplied repost may become the canonical record");
duplicate = findExactJobDuplicate(job("repost", {
  url: "https://www.linkedin.com/jobs/view/4999999999/",
  applyUrl: "https://job-boards.greenhouse.io/remotecom/jobs/7813609003",
  company: "Remote",
  fetched: "2026-08-17",
}), jobs, { preferExisting: true });
assert.equal(duplicate?.job.id, "old-requisition", "ingestion must stop on an existing requisition before creating another record");
assert.equal(duplicate?.basis, "employer requisition ID");

duplicate = findExactJobDuplicate(job("distinct-requisition", {
  url: "https://www.linkedin.com/jobs/view/4999999998/",
  applyUrl: "https://job-boards.greenhouse.io/remotecom/jobs/7885156003",
  company: "Remote",
  title: "Senior Product Manager, Reporting & Insights",
}), jobs);
assert.equal(duplicate, null, "same company and title with a different requisition must remain distinct");
assert.equal(assessScreenability(job("distinct-requisition", {
  url: "https://www.linkedin.com/jobs/view/4999999998/",
  applyUrl: "https://job-boards.greenhouse.io/remotecom/jobs/7885156003",
  company: "Remote",
  title: "Senior Product Manager, Reporting & Insights",
  description: "A complete job description.",
}), jobs, {}).state, "ready");

assert.deepEqual(resolveJobIdentity({
  company: "Autodesk",
  url: "https://www.linkedin.com/jobs/view/4111111111/",
  applyUrl: "https://autodesk.wd1.myworkdayjobs.com/Ext/job/Remote/Product-Manager_25WD98765",
}), {
  linkedinJobId: "4111111111",
  employerRequisitionId: "25WD98765",
  employerRequisitionSource: "workday:autodesk",
});
assert.deepEqual(resolveJobIdentity({
  company: "Autodesk",
  url: "https://autodesk.wd1.myworkdayjobs.com/Ext/job/Remote/Product-Manager_25WD98765",
}), {
  linkedinJobId: "",
  employerRequisitionId: "25WD98765",
  employerRequisitionSource: "workday:autodesk",
});

const profileId = `job-identity-test-${process.pid}`;
const profileDir = join(process.cwd(), "profiles", profileId);
const existingDir = join(profileDir, "work", "inbox", "4455274666");
try {
  mkdirSync(existingDir, { recursive: true });
  writeFileSync(join(existingDir, "metadata.json"), JSON.stringify({
    url: "https://www.linkedin.com/jobs/view/4455274666/",
    linkedinJobId: "4455274666",
    lifecycle: { status: "applied", appliedAt: "2026-08-15" },
  }));
  const child = spawnSync(process.execPath, [
    "scripts/process-job.mjs",
    "https://www.linkedin.com/jobs/view/same-role-4455274666?trackingId=new",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, RESUME_OS_PROFILE: profileId },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(child.status, 0, child.stderr);
  const result = JSON.parse(child.stdout);
  assert.equal(result.duplicate, true);
  assert.equal(result.duplicateOf, "4455274666");
  assert.equal(result.duplicateBasis, "LinkedIn job ID");
  assert.equal(result.previouslyApplied, true);
  assert.equal(readFileSync(join(existingDir, "metadata.json"), "utf8").includes("same-role"), false);

  const autodeskDir = join(profileDir, "work", "inbox", "autodesk-existing");
  mkdirSync(autodeskDir, { recursive: true });
  writeFileSync(join(autodeskDir, "metadata.json"), JSON.stringify({
    company: "Autodesk",
    applyUrl: "https://autodesk.wd1.myworkdayjobs.com/Ext/job/Remote/Product-Manager_25WD98765",
    lifecycle: { status: "applied", appliedAt: "2026-08-15" },
  }));
  const requisitionChild = spawnSync(process.execPath, [
    "scripts/process-job.mjs",
    "https://autodesk.wd1.myworkdayjobs.com/Ext/job/Toronto/Senior-Product-Manager_25WD98765",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, RESUME_OS_PROFILE: profileId },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(requisitionChild.status, 0, requisitionChild.stderr);
  const requisitionResult = JSON.parse(requisitionChild.stdout);
  assert.equal(requisitionResult.duplicateOf, "autodesk-existing");
  assert.equal(requisitionResult.duplicateBasis, "employer requisition ID");
  assert.equal(requisitionResult.previouslyApplied, true);
} finally {
  rmSync(profileDir, { recursive: true, force: true });
}

console.log("job identity tests: PASS");

function job(id, metadata) {
  return { id, metadata, lifecycle: metadata.lifecycle || {} };
}
