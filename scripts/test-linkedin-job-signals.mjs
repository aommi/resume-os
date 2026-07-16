#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  classifyTopApplicantEvidence,
  parsePostedTimeAgo,
} from "../engine/linkedin-job-signals.mjs";

const currentJobId = "1234567890";

assert.deepEqual(
  classifyTopApplicantEvidence({
    detailFound: true,
    currentJobId,
    candidates: [{
      text: "You’d be a top applicant",
      linkedJobIds: [],
      inRecommendationRegion: false,
    }],
  }),
  {
    value: true,
    status: "confirmed",
    text: "You'd be a top applicant",
    method: "visible_target_job_claim",
  },
);

assert.equal(
  classifyTopApplicantEvidence({
    detailFound: true,
    currentJobId,
    candidates: [{
      text: "You'd be a top applicant - Product Owner",
      linkedJobIds: [],
      inRecommendationRegion: false,
    }],
  }).value,
  true,
  "the rendered match-panel headline may include the job title",
);

assert.equal(
  classifyTopApplicantEvidence({
    detailFound: true,
    currentJobId,
    candidates: [{
      text: "You’d be a top applicant",
      linkedJobIds: ["9999999999"],
      inRecommendationRegion: false,
    }],
  }).value,
  false,
  "a claim linked to another job must not mark the current job as top applicant",
);

assert.equal(
  classifyTopApplicantEvidence({
    detailFound: true,
    currentJobId,
    candidates: [{
      text: "You’d be a top applicant",
      linkedJobIds: [],
      inRecommendationRegion: true,
    }],
  }).value,
  false,
  "a recommendation-region claim must be ignored",
);

assert.equal(
  classifyTopApplicantEvidence({
    detailFound: true,
    currentJobId,
    candidates: [{
      text: "See top applicants for this role",
      linkedJobIds: [],
      inRecommendationRegion: false,
    }],
  }).value,
  false,
  "generic top-applicant copy must not count as a personalized claim",
);

assert.equal(
  classifyTopApplicantEvidence({ detailFound: false, currentJobId }).value,
  null,
  "an unverified detail page must remain unknown",
);

const now = new Date("2026-07-15T12:00:00.000Z");
assert.equal(parsePostedTimeAgo("3 days ago", now), "2026-07-12");
assert.equal(parsePostedTimeAgo("Reposted 2 weeks ago", now), "2026-07-01");
assert.equal(parsePostedTimeAgo("5h ago", now), "2026-07-15");
assert.equal(parsePostedTimeAgo("Promoted", now), "");

console.log("linkedin job signal tests: PASS");
