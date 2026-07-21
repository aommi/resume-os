# Model Comparison Protocol

Use this protocol when assessing a new model for a Resume OS job or comparing two models for the
same job. It has two required layers:

1. deterministic smoke and protected-fact gates;
2. human-vetted judgment cases for resume and bullet quality.

Passing one layer never waives the other. Compare models for a named pipeline job (for example,
`tailor` or `cover_letter`), not as universally “better.” Do not change `engine/models.json` or a
runtime binding until the user reviews the comparison and explicitly approves the model change.

## Before running

Record a run manifest with:

- date and pipeline job being assessed;
- baseline and candidate exact model IDs;
- provider/runtime, effort or reasoning setting, and any temperature/configuration;
- exact prompt/case version;
- whether each run used a fresh context;
- output location.

Use identical prompts and inputs, fresh sessions, and equivalent settings wherever the providers
allow it. Preserve raw outputs without corrections. Model UI nicknames are insufficient when an
exact ID is available.

Reusable fictional smoke inputs live in `evals/smoke/cases/`. Generic smoke outputs use
`evals/smoke/outputs/<run-label>/<case>.md`. Private inputs, model outputs, manifests, and judgments
must live under `profiles/<activeProfile>/work/`—normally
`work/model-evals/<YYYY-MM-DD>-<job>/`—unless an existing profile-local study defines its own durable
location. Never copy real identity or application data into tracked engine eval fixtures.

## Layer 1 — deterministic safety and instruction compliance

### Run the generic smoke suite

1. Read `evals/smoke/eval-instructions.md`.
2. Run every case in `evals/smoke/cases/` independently through both models.
3. Save each raw response using the same case filename under its model/run-label directory.
4. Run:

```bash
node scripts/smoke-test-model.mjs <baseline-label> <candidate-label>
```

The existing runner checks instruction constraints, protected numbers, added protected entities,
skills integrity, gap leakage, and reports novel entities. It does **not** yet deterministically
verify every line listed under a case's `Protected Facts`; review any uncovered fields directly.
`novel_entities` is a review canary, not an automatic failure by itself. A deterministic FAIL or
missing output blocks the candidate until the failure is understood and corrected.

### Apply the protected identity/contact/link gate

The live scorer and builder now enforce this gate through
`engine/resume-protected-facts.mjs`. Run the actual candidate output through
`scripts/score-resume.mjs` or `scripts/build-resume-formats.mjs`; do not substitute an LLM judge for
the deterministic result.

For full resumes, cover letters, application answers, and packages, compare these fields directly
against the authoritative profile/source input:

- full name;
- phone number;
- address/location;
- email address;
- LinkedIn, GitHub, portfolio, project, and every other supplied URL;
- titles, employers, dates, schools, degrees, credentials, named tools, and metrics.

Identity, the complete Markdown contact block, and link values are exact invariants. They must remain
present and exactly unchanged; a model may not shorten, reformat, regenerate, substitute, or
“improve” them. A missing, changed, or invented value is a hard FAIL. The profile's `contact.links` are mandatory contact-block
links; `resumeLinks` is the allowlist for conditional project/credential URLs. Every emitted HTTP(S)
URL must be canonical, and a configured URL is mandatory when its `requiredWhenText` marker appears.
Perform this check even when the generic smoke suite does not contain real contact data.

For other protected facts, preserve the source meaning and scope: qualifiers (`mostly`, `about`,
`contributed to`), denominators, cohorts, before/after boundaries, ownership, and the distinction
between delivered work and future vision. Do not approve a model on aggregate score if it fails any
protected fact.

## Layer 2 — human-vetted resume and bullet judgment

Use a self-contained, frozen case bank with source facts, accepted defaults and alternates, target
lenses, FAIL triggers, and rejected/weaker patterns. If the active profile has a vetted private bank,
use it—for example, `profiles/<activeProfile>/work/bullet-study/eval-cases.md`. Otherwise create the
smallest representative private set under `work/model-evals/`; do not invent gold answers after
seeing the candidate output.

Choose cases that cover different risks, such as:

- adjacent-initiative metric merging;
- ownership or model-building inflation;
- qualifier and measurement-scope loss;
- delivered capability versus future vision;
- grounded but materially weaker framing.

Run the same frozen generation prompt independently through the baseline and candidate. Withhold
accepted wording and FAIL triggers from generators. Preserve the raw responses, model IDs, and
settings before judging.

Judge every model/case using:

- **FAIL** — factual error or claim-boundary violation, including borrowed/invented facts, inflated
  ownership, changed qualifier or scope, or vision presented as delivered.
- **PASS** — an accepted default or a grounded expression comparably strong to an accepted alternate.
- **REVIEW** — defensible but materially weaker wording, a subjective preference, or a new grounded
  lens requiring human judgment.

Do not convert taste into FAIL. Do not average away factual failures. Explain every FAIL and REVIEW
against the locked case. Exact wording is not required.

For a blind second judgment, use a model that is not one of the compared generators. Give it only
the verdict definitions, locked case keys, and frozen raw responses—not an earlier verdict or
ranking. Record its exact model/version, provider/runtime, effort setting, date, and raw signed
assessment. Reconcile disagreements without rewriting either judge. If the judge is also a compared
model, disclose that it is context-independent but not model-independent and do not use its ranking
as a tie-breaker for itself.

## Decision rules

Evaluate suitability for the named pipeline job:

| Result | Decision |
|---|---|
| Any identity/contact/link mutation | Reject for the job; hard FAIL |
| Candidate has a factual FAIL the baseline avoids | Do not switch; fix prompt/model or add a guard and rerun |
| Deterministic smoke gate or gap-leakage FAIL | Do not switch |
| No FAILs, but one or more REVIEWs | Human decides whether the quality tradeoff is acceptable |
| Both models are clean | Treat as a quality tie unless enough cases show a stable difference; compare cost, latency, availability, and operational fit |
| Too few cases or unstable judge rankings | Conclude “insufficient to rank”; do not manufacture a winner |

A three-case comparison can validate that cases detect real boundary differences, but it normally
cannot establish a general capability ranking. Expand only with the smallest additional cases that
represent a demonstrated blind spot.

## Required handoff record

The final comparison must contain:

1. run manifest and exact prompts/cases;
2. raw outputs for both models;
3. Layer 1 command result plus protected-field check;
4. Layer 2 PASS/REVIEW/FAIL table and reasons;
5. blind-judge signature and reconciliation, when used;
6. task-scoped recommendation and known uncertainty;
7. explicit user decision: switch, keep baseline, or gather more evidence.

Only after approval: update the runtime binding and `engine/models.json` together, then record the
actual model used in the normal run log/heartbeat. Declared-versus-actual drift is a bug.
