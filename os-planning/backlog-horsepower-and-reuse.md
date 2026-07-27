# Resume OS Job-Seeker Backlog

**Purpose:** keep only work that helps a job seeker produce safer, better, or faster applications.

This is the canonical active planning document. It is intentionally not a full product roadmap, SaaS
plan, model-platform design, or research archive. Superseded planning lives in `os-planning/archive/`;
implemented behavior lives in `memory/semantic.md`, `resume-os.md`, and the relevant scripts/docs.

## Decision Filter

Keep a story only if it improves at least one of:

- more valid applications reviewed per week;
- fewer factual, identity, contact, link, or layout failures;
- faster human review and submission;
- better learning from actual application outcomes;
- easier reuse by another job seeker without weakening the current workflow.

Cut or archive anything that mostly serves future SaaS/MCP, generalized model plumbing, historical
debate, or speculative automation.

## Shipped And No Longer Open

- Multi-profile architecture, example profile, config-aware paths, resolver route, and `models.json`.
- Working data under `profiles/<activeProfile>/work/`; root working-state dirs are retired.
- Job board freshness/heartbeat readout, Gmail sync wrapper, daily brief wrapper, and zero-LLM
  heartbeat watchdog.
- LinkedIn assessment worker with lock, stop state, bounded retries, heartbeat, and assessment cap.
- Company exclusions and profile-relative package path handling.
- Vetted-bullet study adoption: `profiles/<activeProfile>/sources/vetted-bullets.md` is consulted
  during tailoring, Story IDs are cited when used, and fact corrections reopen affected stories.
- Protected resume identity/contact/link gate: scorer and builder fail on changed name, contact block,
  required links, invented URLs, or missing conditional project/credential URLs.
- Model comparison runbook: use `evals/model-comparison.md`; `model-change-evals-plan.md` is design
  rationale only.

## Active Priorities

### P1 — Learn What Is Working

This should come before building more automation. Without outcome data, the system cannot tell whether
deep tailoring, light tailoring, base choice, or job source is actually helping.

| ID | Story | Why It Matters | Acceptance |
|---|---|---|---|
| OUT-1 | Outcomes report | Shows whether applications are converting by source, fit, base variant, and tailoring depth. | One command prints applications, responses, screens, interviews, rejections, and offers grouped by source/base/depth/fit. |
| OUT-2 | Review ritual | Keeps the numbers from becoming unused telemetry. | `review-schedule.md` has a recurring outcome-review entry; first review is logged in the profile tracker or learnings. |

### P2 — Triage Before Tailoring

The next throughput gain is deciding what deserves effort before spending model time on packages.

| ID | Story | Why It Matters | Acceptance |
|---|---|---|---|
| TRI-1 | Fit-triage skill | Ranks jobs and chooses base/depth with explicit reasons instead of first-in-first-out packaging. Judgment belongs in markdown. | A `triage` route loads the skill; triage writes fit, base, depth, and skip reasons to job metadata; spot-checks agree with user judgment. |
| TRI-2 | Triage labels from human review | Makes future model/prompt downgrades evidence-based. | When the user approves, vetoes, or reroutes a job, the decision, input snapshot, model recommendation, correction, and reason are appended to a profile-local label log. |
| TRI-3 | Draft-before-ready lifecycle | Prevents unattended output from looking submit-ready before human review. | Job lifecycle distinguishes `package_draft` from `package_ready`, or the daily digest has an explicit reviewed checkbox that gates readiness. |

### P3 — Smaller Safe Package Drainer

Build unattended throughput only after triage and draft state exist. Keep it boring and fail-closed.

| ID | Story | Why It Matters | Acceptance |
|---|---|---|---|
| QDR-1 | Nightly package drainer V0 | Converts a reviewed queue into morning drafts. | Scheduled local job attempts N jobs, isolates per-job failures, records run state, times out safely, never marks partial packages ready, and leaves a digest. Start with N=2. |
| QDR-2 | Morning package digest | Makes review fast enough to use daily. | Digest lists package path, apply URL/status, scorecard result, true gaps, waivers, and links to rendered PNG/PDF for each draft. |
| QDR-3 | Per-package run log | Helps diagnose failures and compare cost/latency by step. | Each generated package gets `run_log.json` with step, model, duration, status, and error category where available. |

### P4 — Apply Surface And Answer Ledger

This is higher user value than full auto-apply: it turns submission into fill-from-ledger and prevents
invented answers.

| ID | Story | Why It Matters | Acceptance |
|---|---|---|---|
| APP-1 | Harden apply-URL extraction | Missing apply URLs block real submission work. | Every job records `applyUrlStatus`: `extracted`, `easy_apply`, `blocked`, or `not_attempted`; silent null is invalid. |
| APP-2 | ATS detection | Enables question fetching and future platform policy. | Jobs with apply URLs record `atsPlatform` from hostname lookup; unknown is `other`, never guessed. |
| APP-3 | Apply-surface visibility | Makes missing questions/apply URLs visible in review. | Board and digest show apply URL status, ATS, and question status. |
| APP-4 | Fetch real application questions | Avoids drafting answers to imagined questions. | Greenhouse/Lever/Ashby-supported jobs produce sourced real questions; Easy Apply/Workday record unavailable/manual-paste. |
| APP-5 | Answers ledger | Preserves exactly what was or will be submitted. | Packages with real questions include `answers.md` with question, draft/submitted status, source pointer, date, and unsupported-answer flags. Submitted answers freeze. |

### P5 — Quality Checks That Directly Protect Shipping

Keep only checks that catch real package defects.

| ID | Story | Why It Matters | Acceptance |
|---|---|---|---|
| DOC-1 | Package PNG in digest | Human visual review catches layout issues code misses. | Every morning digest links or embeds each package PNG. |
| DOC-2 | Cover-letter renderer | Removes ad hoc Chrome commands and header/footer mistakes. | One command renders a cover letter PDF, verifies one page, and checks for browser header/footer text. |
| DOC-3 | Setup dependency clarity | Prevents second-user failure on hidden local dependencies. | README quickstart documents Python/PDF extraction needs or the dependency is replaced with a clearer Node path. |
| CL-1 | Cover-letter specificity check | Reduces generic openings/closings. | Cover-letter guidance requires at least one company/product/job-specific fact in the opener or close when a cover letter is created. |

### P5.5 — Conversation-Fit Prep Assets (candidate, needs decision-filter check)

Surfaced from a founder-referral conversation (2026-07-24). Tailoring optimizes a resume against the
current JD, so evidence that is strong for a founder conversation but weak on the page gets correctly
downgraded. Example: a candidate's older CRM campaign-management and ROI experience mapped directly
onto the employer's stated roadmap priority, but tailoring filed it "adjacent / partial / weave
carefully" because it is old and not a JD hard keyword. It was captured, just never promoted to a
talking point. The tailoring lens has no pass that ranks evidence by roadmap-fit / conversation value.

| ID | Story | Why It Matters | Acceptance |
|---|---|---|---|
| PREP-1 | Roadmap-fit talking-point pass | Turns intel + package into interview/conversation assets, surfacing older or adjacent evidence that maps to the company's stated direction even when it stays minor on the resume. | When a package has company intel with a roadmap/direction, a prep pass emits talking points that link that direction to specific candidate stories with claim boundaries, distinct from the resume keyword table. |

Decision-filter note: this serves interview conversion, not package production, so it is one step
outside the current backlog scope ("valid applications produced"). Confirm it passes the filter before
promoting it above P6; otherwise keep it here as a candidate.

### P6 — Reuse For Another Job Seeker

Do this after the current job-seeker loop is smoother. Keep it practical: second-user setup, not SaaS.

| ID | Story | Why It Matters | Acceptance |
|---|---|---|---|
| REP-1 | Parameterize remaining profile taste | Prevents one candidate's preferences from leaking into shared methodology. | Methodology has no candidate-specific role names, numbers, or taste rules except marked examples; profile taste lives under `profiles/<id>/`. |
| REP-2 | Profile-owned base routing | Lets different job seekers have different base resumes and routing rules. | Base-routing rules are read from `profile.json`; example and active profiles validate. |
| REP-3 | First-30-minutes README | Makes the open-source repo usable by a technical job seeker. | Fresh clone can run the example profile; README explains profile creation, Chrome/browser setup, PDF dependency, and first build. |
| REP-4 | Intake skill | Removes the biggest barrier for a new user: creating source material. | A synthetic or willing second user can go from old resume/LinkedIn export to validated profile, sources, and first scored base resume in one guided session. |

## Target Design — Proposals As The Daily To-Do (registered 2026-07-27, undecided)

Direction agreed in principle; sequencing and scope deliberately not decided yet.

Screening emits **proposals, never actions**. The daily brief renders the open proposals as a
ranked to-do list. Trust is built by reading that list before anything executes it, and only then
is any step handed to a co-worker or computer-use agent.

Constraints worth honouring whenever this is built, because they are cheap now and expensive to
retrofit:

- **Stateful, not regenerated.** Proposals persist with a status and the brief shows deltas
  (new / aging / done). A to-do recomputed each morning re-proposes completed work and gets
  skimmed past — the failure mode that let 13 packages expire unsent in June.
- **Capped daily surface.** Three to five ranked actions in the brief; the rest waits in the queue.
  An uncapped list is the 210-job backlog in a new wrapper.
- **Typed actions.** `build_package`, `apply_ats`, `confirm_location`, `send_outreach`, with
  parameters. Prose proposals can never be handed to an agent.
- **Autonomy ceiling fixed per action type, from the start.** `build_package` and
  `confirm_location` are agent-safe. `apply_ats` is a future candidate subject to review.
  `send_outreach` is permanently `human_only`: it speaks in the candidate's voice to a real person
  who replies to the candidate. Anything committing the candidate to a claim about their background
  is likewise human-only.

Dependencies: the daily brief must be alive (it is not — see the `/bin/bash` TCC failure), and a
package/proposal aging alert must exist, or a proposal rots silently exactly as a package did.

Cheapest first step, requiring no new infrastructure: run `job-screening.md` manually for a week and
read the proposals. Automate the trigger only if they hold up.

## Explicitly Deferred Or Cut

- **Full auto-apply driver:** cut from active roadmap. Keep the package/answers/receipt conventions
  auto-apply-ready, but do not build a driver until manual package volume and apply-surface extraction
  are working reliably.
- **SaaS, MCP, database, web UI, provider abstraction:** not active job-seeker work.
- **Vision cascade:** only revisit when real application-question or field-location failures justify it.
- **Heavy eval platform:** do not build. Use `evals/model-comparison.md`; add narrow per-job replay sets
  only when changing or downgrading a model.
- **Additional bullet research:** no active plan. New craft observations go through the profile-local
  craft-candidates flow unless a deliberately planned study is approved up front.
- **Historical architecture refactor plan:** implemented enough to stop serving as the roadmap.

## Suggested Sequence

1. OUT-1 / OUT-2.
2. TRI-1 / TRI-2 / TRI-3.
3. QDR-1 / QDR-2 / QDR-3.
4. APP-1 / APP-2 / APP-3, then APP-4 / APP-5.
5. DOC-1 / DOC-2 / DOC-3 / CL-1 as opportunistic quality work.
6. REP-1 / REP-2 / REP-3 / REP-4 once the current loop is stable.

## Do Not Re-Add Without A New Decision

- giant LLM job maps;
- broad future-platform roadmaps;
- ApplyCling archaeology;
- model-provider abstractions;
- speculative automated submission;
- completed research tasks as active backlog items.
