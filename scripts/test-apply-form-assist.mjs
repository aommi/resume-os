#!/usr/bin/env node
import assert from "node:assert";
import { buildAutofillPlan, profileValueMap } from "./apply-form-assist.mjs";

const profile = {
  fullName: "Jordan Rivera",
  contact: {
    email: "jordan.rivera@example.com",
    phone: "(555) 014-2733",
    city: "Toronto",
    province: "Ontario",
    country: "Canada",
    resumeLocation: "Toronto, ON",
    links: ["linkedin.com/in/jordanrivera-example", "github.com/jordan-example"],
  },
  atsAnswers: {
    legallyAbleToWork: "Yes",
    howDidYouHear: "LinkedIn Jobs",
  },
};

const values = profileValueMap(profile);
assert.equal(values["profile.firstName"], "Jordan");
assert.equal(values["profile.lastName"], "Rivera");
assert.equal(values["profile.linkedin"], "linkedin.com/in/jordanrivera-example");
assert.equal(values["profile.github"], "github.com/jordan-example");
assert.equal(values["ats.legallyAbleToWork"], "Yes");

const manifest = {
  url: "https://example.com/apply",
  clickBeforeFill: [{ text: "Apply for this job", purpose: "open_form" }],
  fields: [
    { label: "First", selector: "input[name=first]", valueFrom: "profile.firstName" },
    { label: "Email", selectors: ["input[type=email]"], valueFrom: "profile.email" },
    { label: "Optional blank", selector: "input[name=blank]", valueFrom: "profile.addressLine1", required: false },
  ],
  fileUploads: [
    { label: "Optional resume", selector: "input[type=file]", path: "applications/Example/resume.pdf", required: false },
  ],
};

const plan = buildAutofillPlan({ manifest, profile, work: "/tmp/resume-os-work" });
assert.equal(plan.url, "https://example.com/apply");
assert.equal(plan.clicks.length, 1);
assert.equal(plan.fields.length, 3);
assert.equal(plan.fields[0].value, "Jordan");
assert.equal(plan.fields[1].value, "jordan.rivera@example.com");
assert.equal(plan.fileUploads[0].path, "/tmp/resume-os-work/applications/Example/resume.pdf");
assert.deepEqual(plan.unresolved, []);

assert.throws(
  () => buildAutofillPlan({ manifest: { fields: [] }, profile, work: "/tmp" }),
  /manifest.url is required/,
);

console.log("application form assist tests: PASS");
