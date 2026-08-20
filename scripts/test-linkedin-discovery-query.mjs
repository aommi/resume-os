#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  DEFAULT_LINKEDIN_RECENCY_SECONDS,
  buildLinkedInSearchUrl,
  dedupeSearchResults,
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
