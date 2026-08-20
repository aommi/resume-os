#!/usr/bin/env node
import assert from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAutofillPlan,
  fillField,
  findExactOption,
  installNoSubmitGuards,
  isReadOnlyHttpMethod,
  loadManifest,
  openFormControlPolicy,
  profileValueMap,
  resolveApplicationPackage,
  resolveUploadPath,
  summarizeActions,
  uploadFile,
} from "./apply-form-assist.mjs";

const fixtureRoot = mkdtempSync(join(tmpdir(), "resume-os-form-assist-"));
const work = join(fixtureRoot, "work");
const applications = join(work, "applications");
const packageDir = join(applications, "ExampleCo - Product Manager");
mkdirSync(packageDir, { recursive: true });
const resumePath = join(packageDir, "resume.pdf");
writeFileSync(resumePath, "fictional resume fixture");

try {
  const profile = {
    profileId: "example",
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
    profileId: "example",
    url: "https://example.com/apply",
    applicationPackage: "applications/ExampleCo - Product Manager",
    clickBeforeFill: [{ text: "Apply for this job", purpose: "open_form" }],
    fields: [
      { label: "First", selector: "input[name=first]", valueFrom: "profile.firstName" },
      { label: "Email", selectors: ["input[type=email]"], valueFrom: "profile.email" },
      { label: "Optional blank", selector: "input[name=blank]", valueFrom: "profile.addressLine1", required: false },
      { label: "Explicit false", selector: "input[name=false]", value: false, type: "checkbox", required: false },
    ],
    fileUploads: [
      { label: "Resume", selector: "input[type=file]", path: "resume.pdf" },
    ],
  };

  const plan = buildAutofillPlan({ manifest, profile, work });
  assert.equal(plan.profileId, "example");
  assert.equal(plan.url, "https://example.com/apply");
  assert.equal(plan.applicationPackage, packageDir);
  assert.equal(plan.clicks.length, 1);
  assert.equal(plan.fields[0].value, "Jordan");
  assert.equal(plan.fields[1].value, "jordan.rivera@example.com");
  assert.equal(plan.fields[2].skipReason, "blank optional value");
  assert.equal(plan.fields[3].skipReason, "");
  assert.equal(plan.fields[3].value, false);
  assert.equal(plan.fileUploads[0].path, resumePath);
  assert.deepEqual(plan.unresolved, []);

  assert.throws(
    () => buildAutofillPlan({ manifest: { fields: [] }, profile, work }),
    /manifest.url is required/,
  );
  assert.throws(
    () => buildAutofillPlan({ manifest: { ...manifest, profileId: "different" }, profile, work }),
    /does not match active profile/,
  );
  assert.throws(
    () => buildAutofillPlan({ manifest: { ...manifest, profileId: "" }, profile, work }),
    /manifest.profileId is required/,
  );
  assert.throws(
    () => buildAutofillPlan({
      manifest: { ...manifest, fields: [{ label: "Unknown", valueFrom: "profile.unknown", required: false }], fileUploads: [] },
      profile,
      work,
    }),
    /unknown valueFrom key/,
  );
  const missingRequired = buildAutofillPlan({
    manifest: { ...manifest, fields: [{ label: "Required blank", value: "" }], fileUploads: [] },
    profile,
    work,
  });
  assert.deepEqual(missingRequired.unresolved, ["Required blank missing value"]);

  const manifestFile = join(work, "manifest.json");
  writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.equal(loadManifest(manifestFile, work).profileId, "example");
  const outsideManifest = join(fixtureRoot, "outside-manifest.json");
  writeFileSync(outsideManifest, JSON.stringify(manifest));
  assert.throws(() => loadManifest(outsideManifest, work), /manifest must stay inside/);

  assert.equal(resolveApplicationPackage("applications/ExampleCo - Product Manager", work), packageDir);
  assert.throws(() => resolveApplicationPackage(packageDir, work), /must be relative/);
  assert.throws(() => resolveApplicationPackage("applications/nested/../Example", work), /must not contain parent traversal/);
  assert.throws(() => resolveApplicationPackage("sources", work), /application package must stay inside/);
  assert.equal(resolveUploadPath("resume.pdf", packageDir, work), resumePath);
  assert.throws(() => resolveUploadPath("../profile.json", packageDir, work), /must not contain parent traversal/);
  assert.throws(() => resolveUploadPath("nested/../resume.pdf", packageDir, work), /must not contain parent traversal/);
  assert.throws(() => resolveUploadPath(resumePath, packageDir, work), /must be relative/);
  const outsideFile = join(fixtureRoot, "outside.pdf");
  writeFileSync(outsideFile, "outside fixture");
  const symlinkPath = join(packageDir, "linked.pdf");
  symlinkSync(outsideFile, symlinkPath);
  assert.throws(() => resolveUploadPath("linked.pdf", packageDir, work), /upload file must stay inside/);

  const options = [
    { index: 0, label: "Choose", value: "" },
    { index: 1, label: "Yes", value: "yes" },
    { index: 2, label: "Yes, sponsorship required", value: "yes_sponsorship" },
  ];
  assert.equal(findExactOption(options, " yes ", "label").index, 1);
  assert.equal(findExactOption(options, "YES", "value").index, 1);
  assert.throws(() => findExactOption(options, "sponsorship", "label"), /no exact label match/);
  assert.throws(() => findExactOption(options, "", "label"), /blank value/);
  assert.throws(
    () => findExactOption([...options, { index: 3, label: " yes ", value: "yes_again" }], "Yes", "label"),
    /ambiguous exact label match/,
  );

  assert.deepEqual(
    openFormControlPolicy(
      { tagName: "a", type: "", inForm: false, formAction: "", href: "https://example.com/apply", text: "Apply", ariaLabel: "", name: "", value: "", title: "" },
      { label: "Open application", text: "Apply", selector: "" },
    ),
    { allowed: true, reason: "safe link" },
  );
  assert.equal(openFormControlPolicy(
    { tagName: "button", type: "submit", inForm: false, formAction: "", href: "", text: "Continue", ariaLabel: "", name: "", value: "", title: "" },
    { label: "Continue" },
  ).allowed, false);
  assert.equal(openFormControlPolicy(
    { tagName: "button", type: "button", inForm: true, formAction: "", href: "", text: "Continue", ariaLabel: "", name: "", value: "", title: "" },
    { label: "Continue" },
  ).reason, "refused control inside a form");
  assert.equal(openFormControlPolicy(
    { tagName: "button", type: "button", inForm: false, formAction: "", href: "", text: "Continue", ariaLabel: "Submit application", name: "", value: "", title: "" },
    { label: "Continue" },
  ).reason, "refused final-submit-like click");

  assert.equal(isReadOnlyHttpMethod("GET"), true);
  assert.equal(isReadOnlyHttpMethod("head"), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(isReadOnlyHttpMethod(method), false);
  const safety = { formSubmitsBlocked: 0, mutationRequestsBlocked: 0 };
  let routeHandler;
  let initScript;
  let bindingCallback;
  await installNoSubmitGuards({
    async exposeBinding(name, callback) {
      assert.equal(name, "__resumeOsRecordBlockedSubmit");
      bindingCallback = callback;
    },
    async addInitScript(callback) {
      initScript = callback;
    },
    async route(pattern, callback) {
      assert.equal(pattern, "**/*");
      routeHandler = callback;
    },
  }, safety);
  assert.equal(typeof bindingCallback, "function");
  assert.equal(typeof initScript, "function");
  let submitListener;
  class FakeForm {
    submit() { throw new Error("native submit should be replaced"); }
    requestSubmit() { throw new Error("native requestSubmit should be replaced"); }
  }
  globalThis.document = {
    addEventListener(name, callback) {
      assert.equal(name, "submit");
      submitListener = callback;
    },
  };
  globalThis.HTMLFormElement = FakeForm;
  globalThis.__resumeOsRecordBlockedSubmit = () => bindingCallback();
  try {
    initScript();
    const form = new FakeForm();
    form.submit();
    form.requestSubmit();
    let prevented = false;
    let stopped = false;
    submitListener({ preventDefault: () => { prevented = true; }, stopImmediatePropagation: () => { stopped = true; } });
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(safety.formSubmitsBlocked, 3);
  } finally {
    delete globalThis.document;
    delete globalThis.HTMLFormElement;
    delete globalThis.__resumeOsRecordBlockedSubmit;
  }
  let continued = false;
  await routeHandler({ request: () => ({ method: () => "GET" }), continue: async () => { continued = true; } });
  assert.equal(continued, true);
  let aborted = false;
  await routeHandler({ request: () => ({ method: () => "POST" }), abort: async () => { aborted = true; } });
  assert.equal(aborted, true);
  assert.equal(safety.formSubmitsBlocked, 3);
  assert.equal(safety.mutationRequestsBlocked, 1);

  const skippedBlank = await fillField(null, plan.fields[2]);
  assert.equal(skippedBlank.status, "skipped");
  const noSelectorPage = {
    locator() {
      return { first: () => ({ waitFor: async () => { throw new Error("not found"); } }) };
    },
  };
  assert.equal((await fillField(noSelectorPage, { label: "Required", selectors: ["#missing"], value: "x", required: true })).status, "error");
  assert.equal((await fillField(noSelectorPage, { label: "Optional", selectors: ["#missing"], value: "x", required: false })).status, "skipped");
  assert.equal((await uploadFile({
    locator: () => ({ first: () => ({ setInputFiles: async () => { throw new Error("upload failed"); } }) }),
  }, { label: "Required upload", selectors: ["input"], path: resumePath, required: true })).status, "error");
  assert.equal((await uploadFile(null, { label: "Optional upload", selectors: ["input"], path: "", required: false, skipReason: "missing optional file" })).status, "skipped");

  assert.equal(summarizeActions([{ status: "ok" }, { status: "skipped" }]).status, "complete");
  const incomplete = summarizeActions([{ label: "Required", status: "error" }, { status: "skipped" }]);
  assert.equal(incomplete.status, "incomplete");
  assert.deepEqual(incomplete.requiredErrors, [{ label: "Required", status: "error" }]);

  console.log("application form assist tests: PASS");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
