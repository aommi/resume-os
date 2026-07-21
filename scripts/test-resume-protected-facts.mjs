import assert from "node:assert/strict";
import { validateResumeProtectedFacts } from "../engine/resume-protected-facts.mjs";

const profile = {
  fullName: "Jordan Rivera",
  contact: {
    email: "jordan.rivera@example.com",
    phone: "(555) 014-2733",
    resumeLocation: "Toronto, ON",
    resumeContactLines: [
      "jordan.rivera@example.com | (555) 014-2733 | Toronto, ON",
      "[LinkedIn](https://www.linkedin.com/in/jordan-rivera/) | [GitHub](https://github.com/jordan-rivera)",
    ],
    links: [
      "https://www.linkedin.com/in/jordan-rivera/",
      "https://github.com/jordan-rivera",
    ],
  },
  resumeLinks: [
    { url: "https://github.com/jordan-rivera/project", requiredWhenText: "### Project Atlas" },
    { url: "https://project-atlas.example.com/", requiredWhenText: "### Project Atlas" },
  ],
};

const valid = `# Jordan Rivera

jordan.rivera@example.com | (555) 014-2733 | Toronto, ON
[LinkedIn](https://www.linkedin.com/in/jordan-rivera/) | [GitHub](https://github.com/jordan-rivera)

**Senior Product Manager**

## SELECTED PROJECTS

### Project Atlas
[Repo](https://github.com/jordan-rivera/project) · [Live](https://project-atlas.example.com/)
- Built a grounded test fixture
`;

expectPass("valid protected facts", valid);
expectFail("changed name", valid.replace("# Jordan Rivera", "# Jordan Rivers"), "profile.fullName");
expectFail("missing email", valid.replace("jordan.rivera@example.com | ", ""), "email");
expectFail("reformatted phone", valid.replace("(555) 014-2733", "555-014-2733"), "phone");
expectFail("changed location", valid.replace("Toronto, ON", "Toronto, Ontario"), "resume location");
expectFail(
  "extra contact text",
  valid.replace("Toronto, ON", "Toronto, ON | invented.example.com"),
  "contact block does not exactly match",
);
expectFail(
  "changed contact link",
  valid.replace("https://github.com/jordan-rivera)", "https://github.com/jordan-rivers)"),
  "required contact link",
);
expectFail(
  "invented URL",
  valid.replace("Built a grounded test fixture", "Built a grounded test fixture at https://invented.example.com/"),
  "not canonical/allowlisted",
);
expectFail(
  "missing project URL",
  valid.replace("[Live](https://project-atlas.example.com/)", "Live deployment"),
  "required URL missing",
);

const missingCanonicalLinks = structuredClone(profile);
missingCanonicalLinks.contact.links = [];
assert.ok(
  validateResumeProtectedFacts(valid, missingCanonicalLinks).some((error) => error.includes("not canonical/allowlisted")),
  "an empty canonical link list must reject emitted URLs",
);

const noLinkProfile = structuredClone(profile);
noLinkProfile.contact.links = [];
noLinkProfile.contact.resumeContactLines = ["jordan.rivera@example.com | (555) 014-2733 | Toronto, ON"];
noLinkProfile.resumeLinks = [];
const noLinkResume = valid
  .replace("\n[LinkedIn](https://www.linkedin.com/in/jordan-rivera/) | [GitHub](https://github.com/jordan-rivera)", "")
  .replace(/\n### Project Atlas[\s\S]*$/, "\n");
assert.deepEqual(validateResumeProtectedFacts(noLinkResume, noLinkProfile), [], "profiles may intentionally have no links");

assert.ok(
  validateResumeProtectedFacts(valid, { profileId: "incomplete" }).some((error) => error.includes("profile.fullName")),
  "a present but incomplete profile must fail closed",
);

const withoutProject = valid.replace(/\n### Project Atlas[\s\S]*$/, "\n");
expectPass("conditional project links may be absent when project is absent", withoutProject);

console.log("resume-protected-facts: ALL 13 PASS");

function expectPass(label, markdown) {
  assert.deepEqual(validateResumeProtectedFacts(markdown, profile), [], label);
}

function expectFail(label, markdown, expected) {
  const errors = validateResumeProtectedFacts(markdown, profile);
  assert.ok(errors.some((error) => error.includes(expected)), `${label}: ${errors.join("; ")}`);
}
