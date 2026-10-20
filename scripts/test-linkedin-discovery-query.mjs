#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  DEFAULT_LINKEDIN_RECENCY_SECONDS,
  buildLinkedInSearchUrl,
  dedupeSearchResults,
  matchesSearchTitle,
  resolveRecencySeconds,
} from "../engine/linkedin-discovery-query.mjs";

assert.equal(resolveRecencySeconds(null), DEFAULT_LINKEDIN_RECENCY_SECONDS);
assert.equal(
  resolveRecencySeconds("2026-08-20T00:00:00Z", Date.parse("2026-08-20T00:00:01.001Z")),
  2,
  "partial seconds round up so the boundary is not missed",
);
assert.equal(
  resolveRecencySeconds("2026-08-19T20:00:00-04:00", Date.parse("2026-08-20T00:00:01Z")),
  1,
);
for (const invalid of [
  "08/20/2026 10:00",
  "2026-02-30T10:00:00Z",
  "2026-08-20",
  "2026-08-20T10:00:00",
]) {
  assert.throws(() => resolveRecencySeconds(invalid), /Invalid --since ISO timestamp/);
}
assert.throws(
  () => resolveRecencySeconds("2026-08-20T00:00:01Z", Date.parse("2026-08-20T00:00:01Z")),
  /must be earlier than now/,
);
assert.throws(
  () => resolveRecencySeconds("2026-08-20T00:00:02Z", Date.parse("2026-08-20T00:00:01Z")),
  /must be earlier than now/,
);

const searchUrl = new URL(buildLinkedInSearchUrl("product manager", "Canada", 1234));
assert.equal(searchUrl.searchParams.get("keywords"), "product manager");
assert.equal(searchUrl.searchParams.get("location"), "Canada");
assert.equal(searchUrl.searchParams.get("f_TPR"), "r1234");
assert.equal(searchUrl.searchParams.get("sortBy"), "DD");
assert.equal(searchUrl.searchParams.get("start"), "0");

assert.deepEqual(dedupeSearchResults([
  { linkedinJobId: "100", url: "https://www.linkedin.com/jobs/view/100/" },
  { linkedinJobId: "100", url: "https://www.linkedin.com/jobs/view/100/?tracking=new" },
  { linkedinJobId: "200", url: "https://www.linkedin.com/jobs/view/200/" },
  { linkedinJobId: "201", url: "https://www.linkedin.com/jobs/view/200/" },
  { url: "https://example.com/jobs/300" },
  { url: "https://example.com/jobs/300" },
]), [
  { linkedinJobId: "100", url: "https://www.linkedin.com/jobs/view/100/" },
  { linkedinJobId: "200", url: "https://www.linkedin.com/jobs/view/200/" },
  { linkedinJobId: "201", url: "https://www.linkedin.com/jobs/view/200/" },
  { url: "https://example.com/jobs/300" },
]);

console.log("linkedin discovery query tests: PASS");

const titlePhrases = ["PM", "PO", "Product Manager", "Product Owner", "Product Lead",
  "Product Management", "Director of Product", "Head of Product", "VP of Product",
  "Chief Product Officer"];
for (const title of ["PM", "Senior PM - Communications", "Sr. PM, Platform", "PO",
  "Senior PO", "Senior Product Manager", "Staff Product Manager", "Principal Product Manager",
  "Group Product Manager", "Senior Product Owner", "Product-Owner, Data", "Lead Product Manager",
  "Director of Product", "Senior Director of Product Management", "Head of Product",
  "VP of Product", "Chief Product Officer", "Product Lead", "ＰＭ – Platform"]) {
  assert.equal(matchesSearchTitle(title, titlePhrases), true, title);
}
for (const title of ["Product Designer", "Marketing Communications Manager", "PMO Analyst",
  "Program Manager", "Product Marketing Manager", "Portfolio Manager", "Support", "", null]) {
  assert.equal(matchesSearchTitle(title, titlePhrases), false, String(title));
}
assert.equal(matchesSearchTitle("Program Manager", ["Program Manager"]), true,
  "another profile owns its own role choices");
assert.equal(matchesSearchTitle("Senior PM", ["Product Manager"]), false,
  "abbreviation authority comes from the profile, not a hardcoded alias table");
assert.equal(matchesSearchTitle("Senior PM", ["", " "]), false);
console.log("profile-owned title-family matching: PASS");
