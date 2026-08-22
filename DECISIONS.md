# Decisions

Append-only log of architectural decisions for the Resume OS engine. Newest at the bottom.

## Engine vs profiles split (2026-06-25)
**Why accepted:** Multi-tenancy requires separating reusable logic from one person's data.
Engine (skills, config, scripts, schema, templates) is profile-agnostic; each candidate lives
in `profiles/<id>/`.
**Implications:** Tooling resolves paths via `engine/config.mjs`. Private data is gitignored
(`profiles/*`, with `!profiles/example/` for the demo). Engine files must carry zero candidate data.

## Config dual-path resolution (2026-06-25)
**Why accepted:** Allow migration without breaking the working system. Resolvers fall back to
the repo root when a profile dir is absent, so the engine runs before and after data moves.
**Implications:** `engine/config.mjs` is the single resolver for name, timezone, browser path,
and profile dirs. `activeProfile` (config) or `RESUME_OS_PROFILE` (env) selects the profile.

## Resolver + models are schema-only (2026-06-25)
**Why accepted:** Commit task->docs routing and per-step model boundaries without binding to a
runtime (Claude Code / Codex / SDK / MCP). The runtime stays a swap.
**Implications:** `engine/resolver.json` + `engine/resolve.mjs` + `scripts/test-resolver.mjs`;
`engine/models.json`. Unknown intent falls back to a default route so the sparse resolver is
never worse than the old monolith.

## Template separated from the build harness (2026-06-25)
**Why accepted:** Others should restyle resumes without editing build/parse/export logic.
**Implications:** All CSS + HTML skeleton live in `engine/templates/resume-template.mjs`;
`build-resume-formats.mjs` only parses markdown and supplies data. Verified byte-identical output.

## Parity bar is visual/text, not byte (2026-06-25)
**Why accepted:** Chrome PDFs differ byte-for-byte on metadata/timestamps, so byte comparison
gives false failures.
**Implications:** Refactors "pass" on same filenames, page count, extracted text, PNG within
tolerance, and identical `score-resume.mjs` scorecard.

## Public release: genericize, do not publish profile data (2026-06-26)
**Why accepted:** Publishing the engine must not expose the owner's history. Real employers/
projects were genericized to fictional names; private dirs (`profiles/<id>/`, `archive/`,
most of `os-planning/`) are gitignored.
**Implications:** The example profile (Jordan Rivera) and fictional companies are the only
people/companies in the public engine.

## Root working-state must never be tracked (2026-06-26)
**Why accepted:** Incident: an external Gmail monitor wrote job data to old root paths
(`inbox/`, `events/`) that were not gitignored; a `git add -A` swept them into the first public
push, briefly exposing job-tracking data. Repo was made private and the commit rewritten.
**Implications:** Root `inbox/`, `events/`, `applications/`, `resume-formats/`, `jobs-tracker.md`,
`package-queue.md` are gitignored permanently. The work-folder convention (all agents write under
`profiles/<activeProfile>/work/`, never root) is documented in `resume-os.md` Core Rules, `README.md`,
`AGENTS.md`, and `adapters/claude-code-bootstrap.md`. The Gmail-monitor prompt
(`prompts/claude-cowork-gmail-job-monitor.md`) was updated (2026-06-26) to write under the profile
work dir.

## Tailoring evidence dominance and claim boundaries (2026-07-15)
**Why accepted:** Keyword coverage did not reveal when the strongest, most role-relevant evidence
was buried below a recruiter's initial scan. Adjacent domain proof also needs an explicit ownership
boundary so tailoring neither overclaims nor undersells it.
**Implications:** High-fit, ambiguous, referral, and high-stakes packages add a
Requirement-to-Evidence & Visibility table to `strategy.md`. Tailoring identifies one or two
dominant evidence stories before editing and places them in the first two bullets of the most
relevant recent role. Bolding favors target-role relevance over metric magnitude. `keywords.md`
records a claim boundary for each term; it is a judgment constraint, not an ATS requirement.

## Root-memory is engine-only (2026-07-15)
**Why accepted:** Candidate and pipeline notes in root memory blur the engine/profile boundary,
increase privacy risk, and make shared operating context less reusable.
**Implications:** Root `memory/semantic.md`, `memory/working.md`, and candidates/decision memory
contain only Resume OS architecture, durable engine decisions, and engine-only scratch state.
Candidate job, application, outreach, interview, resume-content, and pipeline state belongs only
under `profiles/<id>/`.

## Thin harness, fat skills manual publication gate (2026-07-15)
**Why accepted:** Resume OS should keep judgment in markdown, execution in deterministic tooling,
and runtime orchestration thin without adding an automated compliance system before the need is
proven.
**Implications:** Before publishing a tracked engine change, agents answer the six Architecture
Boundary questions in `resume-os.md` and record `ALIGNED` in the PR description or handoff. Any
exception must be recorded here and linked. The check remains manual and brief; there is no new
skill, resolver route, hook, or CI gate.

## Serialize LinkedIn automation and assess matches asynchronously (2026-07-16)
**Why accepted:** Discovery and match assessment share one authenticated LinkedIn Chrome profile;
overlapping sessions can corrupt the profile or trigger account defenses. Match assessment is slow
but deterministic to orchestrate and does not need a local model.
**Implications:** All automated scripts using the authenticated profile acquire one profile-local
advisory lock before touching Chrome's `SingletonLock`. A scheduled worker processes at most one
eligible job per invocation, stores its assessment in canonical job metadata, fails closed on
explicit authentication challenges, and reports health through a deterministic heartbeat. Fit
triage, package generation, and submission remain separate workflows.

## Craft-candidates staging queue is profile-local, human-gated (2026-07-17)
**Why accepted:** Session-learned craft judgment was being appended directly into engine skill
docs (methodology Pitfalls) with no recurrence test, encoding one session's recency bias or one
profile's taste as permanent engine rules. A cold review of the initial design (an os-planning/
inbox) correctly found: raw craft evidence names companies and application content, so it cannot
live at the engine layer; reviewer agreement is not recurrence; and a second promotion system
must mirror the existing `memory/candidates.md` flow rather than invent new conventions.
**Implications:** `profiles/<id>/craft-candidates.md` stages craft observations (admission:
concrete affected output + counterfactual + reusable test; appending is conditional, never
mandatory at session end). Promotion into engine skill docs is human-approved, sanitized, and
requires distinct-output recurrence — except truth/privacy/numeric-integrity failures, which
qualify immediately. Profile taste routes to `LEARNINGS.md`; domain is a tag, not a tier. Direct
Pitfalls appends are prohibited (methodology amended). Triage triggers at ~10 queued entries with
a monthly fallback via `review-schedule.md`; entries expire after two triages without new
evidence. This is not a planning artifact; the canonical backlog remains the single planning doc.

**Architecture Boundary verdict (2026-07-17): ALIGNED.** (1) Judgment introduced: admission/
promotion criteria for craft learnings. (2) It lives entirely in markdown (queue header,
methodology note, semantic.md) — no code changed. (3) Repeatable execution introduced: none;
triage is a human-gated manual review, deliberately not tooled. (4) Resolver/adapters/harness
gained nothing. (5) Workflow friction is conditional, not universal: appending is optional,
the session-end check is user-invoked, and a profile without the file is a no-op. (6) Verdict
ALIGNED; profile-absence behavior defined in semantic.md.

## A planned human-vetted study can serve as craft-promotion triage (2026-07-21)
**Why accepted:** The nine-story bullet study was a deliberate staging artifact rather than an
ad-hoc session note: it predefined a distinct-story evidence threshold, recorded counterexamples
and claim boundaries, captured human decisions for every story, and validated frozen cases across
multiple models. Requiring its four supported cross-story findings to enter `craft-candidates.md`
and wait for another triage would duplicate the completed evidence and human gate rather than add
signal. The user explicitly approved adoption on 2026-07-21.
**Supersedes/clarifies:** The 2026-07-17 craft-candidates decision still prohibits direct skill-doc
appends from ordinary sessions. A planned study may itself be the staging artifact only when it
predefines recurrence/counterexample criteria, meets them across distinct outputs, sanitizes the
result, and receives explicit human promotion approval. The approved GO is that triage decision;
profile taste still routes to `LEARNINGS.md`.
**Implications:** Four conditional refinements are active in `bullet-rubric.md` and
`tailoring-methodology.md`: metric/initiative/scope separation; the minimum credibility mechanism;
concrete transferable specificity; and intentional relative-versus-absolute metric framing. The
profile-local vetted bank preserves approved wording/lenses and staleness triggers; it does not make
profile evidence part of the public engine.

## Resume identity, contact information, and URLs are profile-owned hard gates (2026-07-21)
**Why accepted:** The renderer previously parsed contact and links from model-editable resume
Markdown and checked only that the contact block was non-empty. A changed phone, email, location, or
URL could therefore pass every build gate. The profile schema already owns candidate identity, so
these fields should be deterministic invariants rather than model judgment.
**Implications:** Profiles define exact Markdown contact-block lines and configured contact links,
plus canonical conditional `resumeLinks` for project/credential URLs. A profile may intentionally
have no links; in that case any emitted URL is non-canonical and fails.
`engine/resume-protected-facts.mjs` rejects a changed heading/contact block, missing required link,
non-canonical emitted URL, or missing conditional URL. Scoring treats this as HARD; building fails
before rendering or delivery. Profiles
without the minimum identity contract retain the legacy fallback, while schema-backed active
profiles fail closed.

**Architecture Boundary verdict (2026-07-21): ALIGNED.** (1) Judgment introduced/altered: four
sanitized writing refinements and the rule that a fully planned study may satisfy human triage.
(2) Judgment lives in Markdown (`bullet-rubric.md`, `tailoring-methodology.md`, this decision); code
contains only exact profile comparisons. (3) Repeatable execution: deterministic identity/contact/
URL validation and tests. (4) The resolver/runtime harness gained no domain judgment. (5) Vetted-bank
loading is conditional on file/story presence; the safety gate is universal only for schema-backed
profiles where identity integrity is always required. (6) Verdict: ALIGNED.

## Match assessment is pull-based, not scheduled (2026-07-27)
**Supersedes the scheduling half of "Serialize LinkedIn automation and assess matches
asynchronously" (2026-07-16).** The locking rationale in that entry still stands and is unchanged.

**Why accepted:** Measured against a fully triaged backlog, LinkedIn's headline match level
predicted screening outcomes poorly — top-labelled roles were culled about half the time and scored
no better than the tier below. The required-qualification breakdown is the part that carries signal,
and it only informs a decision at the moment a human is choosing to invest in a role. A scheduled
sweep therefore spent continuous authenticated LinkedIn activity selecting jobs by posting date
rather than by whether anyone cared about them. (The measurement is a single-profile observation,
not an engine-wide constant.)

**Implications:** `--job-id` targets one job so assessment runs as a screening step; the
`ai.resumeos.assess` LaunchAgent is unloaded. Targeting does not bypass eligibility — the stop file,
shared lock, daily cap, and LinkedIn-URL guard all still apply. The heartbeat records
`cadenceMinutes: 0`, a convention meaning "on-demand", so the watchdog does not report staleness for
a workflow nothing schedules; restoring a sweep requires restoring a non-zero cadence in the same
change, or nothing notices when the sweep dies. Screening judgment about which jobs merit assessment
lives in `job-screening.md`, not in the worker.

## No tracked planning artifacts (2026-07-27)
**Supersedes:** the canonical-backlog portion of the 2026-07-17 craft-candidates decision and the
prior convention that published architecture/planning documents are useful operating context.

**Why accepted:** Backlogs, roadmaps, phased plans, and tickets age faster than code, encourage
pre-building, and had begun to retain profile/pipeline details in a public repository. They are not
durable engine knowledge.

**Implications:** `os-planning/` and model-evaluation planning are local, ignored scratch only. Do
not add tracked planning documents. Select work from current evidence and explicit user direction.
Record durable architectural choices here, shipped behavior in `memory/semantic.md`, and stable
rules in the applicable skill doc.

## Profile-owned exclusions and sourced upcoming events (2026-07-27)
**Why accepted:** Hard-coded employer filters in reusable queue code exposed profile-specific data
and could disagree with discovery. Future interviews were represented only as prose or past contact
dates, so the board could not surface a scheduled event reliably.

**Implications:** `profile.json` `jobSearch.excludedCompanies` is the sole exclusion source and is
applied deterministically at discovery, persistence, assessment, and package-queue selection.
`nextEventAt` is accepted only from an exact future UTC timestamp in a structured email event for a
screen or interview; no tool or model infers it from vague language. The job board is the generated
view of that lifecycle state.

## Telegram is an actionable job-search channel, not a pipeline feed (2026-07-27)
**Why accepted:** Routine pipeline totals, packaging queues, and quiet daily runs do not require a
candidate decision, but consume attention and model tokens. The user wants one concise Telegram
channel for scheduled events, replies/decisions, active interview preparation, and genuine
operational failures.

**Implications:** The daily-brief wrapper deterministically skips the model and delivery unless the
board has an upcoming event, a `Needs Action` row, or an `Interviewing` row. Its prompt contains
only those actionable details. Watchdog remains responsible for deduplicated operational-failure
alerts; it is not repeated in normal job-search digests.

**Architecture Boundary verdict (2026-07-27): ALIGNED.** (1) The notification policy is an explicit
user preference, not resume judgment. (2) The prompt owns concise action framing; code enforces the
exact delivery gate and heartbeat. (3) The wrapper deterministically avoids unnecessary model calls
and sends. (4) No resolver or adapter gained domain logic. (5) The gate removes routine friction
rather than creating a new workflow. (6) Verdict: ALIGNED.

## Screening separates pursue from material strategy (2026-07-27)
**Why accepted:** “Should we pursue this role?” and “how much customization is justified?” have
different cost and automation boundaries. A low-cost base-resume attempt can be worthwhile without
being a strong fit, while a tailoring recommendation can require meaningful human time. Encoding
both in one screening tier made lifecycle state ambiguous and could send base-resume jobs into a
tailoring queue.

**Implications:** Lifecycle status is execution state (`to_review`, `to_apply`, and later states).
Screening persists `pursue` (`apply`, `skip`, or `needs_input`) separately from `strategy`
(`base_resume` or `tailor`, only when pursuing). `apply` moves a record to `to_apply`; `skip` moves
it to `skipped`; `needs_input` remains `to_review` and carries one focused question. Base-resume
jobs do not enter the package-build queue. Screening never applies, sends outreach, or submits a
form; outreach remains a separate human proposal. Existing legacy tiers are read compatibly.

## Screening separates focused and opportunistic applies (2026-07-27)
**Why accepted:** A candidate may submit a low-effort application to an eligible long shot, but that capacity choice must not redefine the screening recommendation.

**Implications:** Stored-fact screenability blocks in-flight/closed rows, exclusions, exact URL duplicates, and missing JDs before screening. `applicationMode` is apply-only: `focused` follows the recommended route; `opportunistic` is base-resume-only and excluded from package, tailoring, outreach, and priority work. Screening must read the profile evidence sources before rejecting a domain as absent.

**Architecture Boundary verdict (2026-07-27): ALIGNED.** Judgment remains in the skill/profile; code validates deterministic stored facts and lifecycle combinations only.

## Tailoring approval and legacy-screening recovery (2026-07-27)
**Clarifies:** Screening separates pursue from material strategy (2026-07-27).

**Implications:** `apply + tailor` does not enter the package queue until an explicit
`approve-tailor` command records approval; re-screening clears it. A dedicated `screenQuestion`
field preserves general notes. `migrate-screening` is dry-run by default and explicitly returns
legacy unscreened `to_apply` rows to review; it never runs during board rendering.

## Preserve evaluation evidence; do not productize one-off labeling aids (2026-07-27)
**Why accepted:** The first job-screening labels needed a small, temporary review aid. Once the
private frozen evaluation set existed, its generator had no recurring user or engine consumer and
introduced tenant-specific cohort logic into tracked code. Adding configuration, schema surface,
and tests would have maintained a feature whose value had already been consumed.

**Implications:** Keep frozen private labels, cases, raw model outputs, and scorecards when they are
the durable evaluation evidence. Remove one-off collection interfaces after use unless a recurring
workflow and an explicit owner are established. When a temporary feature leaks profile-specific
policy into reusable code, deletion is preferred to parameterization by default.

## Ordered runtime fallback for the daily action digest (2026-07-29)
**Why accepted:** A scheduled summary should not fail just because one authenticated inference
provider is temporarily unavailable or returns no usable output. The prior DeepSeek-only override
was incompatible with Hermes's active OpenAI Codex provider, while `gpt-5.6-terra` was verified
through Hermes as the balanced OpenAI cost/quality tier.

**Implications:** `run-daily-brief.sh` tries configured runners sequentially. OpenAI Codex
(`gpt-5.6-terra`) is primary; DeepSeek (`deepseek-v4-pro`) is secondary. It advances only after a
nonzero exit or blank result, delivers exactly one successful brief, and records the successful
model in the heartbeat. Disabled or unconfigured runners, including Claude without a valid
subscription, are not placed in the active chain.

**Architecture Boundary verdict (2026-07-29): ALIGNED.** (1) No resume judgment changed. (2)
The prompt retains all summary judgment. (3) The wrapper deterministically retries a bounded
execution concern and validates nonempty output. (4) No resolver or adapter gained domain logic.
(5) The fallback is conditional on a provider failure. (6) Verdict: ALIGNED.

## Single local Gmail sync path (2026-07-30)
**Why accepted:** The prior scheduled path required Claude subscription access, while the Codex
Gmail connector is explicitly interactive-only and cannot run through `codex exec`. A verified
local Himalaya IMAP account can provide the bounded mailbox read without introducing another agent
or connector cron. OpenAI Terra is the selected balanced extraction model already verified in the
Hermes runtime.

**Implications:** `run-gmail-sync.sh` is the sole scheduled Gmail workflow: Himalaya produces a
short-lived, three-day overlapping profile-work snapshot; Hermes/OpenAI extracts event handoff
files from it; `import-events.mjs` remains the only tracker writer. The machine-owned LaunchAgent
runs it at 07:00 and 19:00. Claude and the paused Hermes Gmail cron are not fallbacks; Codex Gmail
remains an interactive capability only. The importer deduplicates repeated overlapping source IDs,
so retries and the two daily runs do not create duplicated lifecycle events.

**Architecture Boundary verdict (2026-07-30): ALIGNED.** (1) No resume or job-state judgment was
moved into code; the model prompt still classifies events and the importer validates structure. (2)
The extraction judgment remains markdown-prompt guidance. (3) The new deterministic work is a
bounded IMAP snapshot, credential/link redaction, output validation, and import. (4) No resolver
or model harness gained application-domain policy. (5) The schedule replaces a broken path rather
than adding universal workflow friction. (6) Verdict: ALIGNED.

## Application form assist is browser prep, not submission automation (2026-08-05)
**Why accepted:** Computer-use can reduce repetitive application-form filling, but the reusable
engine must not publish private candidate data, job-specific answers, or a submit-capable fat
harness. The recurring capability is to prepare a browser session for human review; the decision to
submit remains outside the script.

**Implications:** `application-form-assist.md` owns judgment and no-submit rules. The resolver has an
`application_form` route. `scripts/apply-form-assist.mjs` is a thin deterministic harness that binds
each manifest to the active profile, leaves blank optional fields untouched, requires exact select
matches, confines uploads to one application package, blocks DOM submission and mutating HTTP
requests, reports required-action failures, and holds the browser open. Real manifests with
job-specific answers live under `profiles/<activeProfile>/work/`; tracked examples use fictional
data only.

**Architecture Boundary verdict (2026-08-05): ALIGNED.** (1) Judgment introduced: application-form
assist may prepare but never submit, and ambiguous answers stay blank. (2) Judgment lives in
Markdown (`application-form-assist.md`, this decision); code performs deterministic browser actions
and safety refusal only. (3) Repeatable execution: manifest dry-run, deterministic profile and path
validation, field fill/upload operations, submission guards, and tests. (4) Resolver gains only a
route to the skill doc; the harness gains no resume/application judgment. (5) Workflow friction is
conditional: only invoked for package-ready application work. (6) Verdict: ALIGNED.

## Exact job identity precedes ingestion and screening deduplication (2026-08-17)

**Why accepted:** Company and title matching cannot distinguish multiple openings at the same
employer, while LinkedIn posting IDs and employer requisition IDs can establish exact identity.
Checking identity after scraping also wastes time and can obscure whether the candidate already
applied to the same requisition.

**Implications:** Job metadata stores `linkedinJobId`, `employerRequisitionId`, and
`employerRequisitionSource` as separate fields. Ingestion checks LinkedIn ID first, employer-scoped
requisition ID second, and canonical URL third. An exact existing identity stops normal ingestion;
prior application evidence is reported. Different requisition IDs remain different jobs even when
company and title match. Legacy records are comparable through URL-derived identities and can be
persisted with the deterministic backfill command. Intentional refresh and signal assessment use
the explicit `--allow-existing` escape hatch.

**Architecture Boundary verdict (2026-08-17): ALIGNED.** (1) No job-fit judgment changed. (2) The
change introduces no subjective judgment. (3) ID extraction, lookup precedence, duplicate stopping,
and backfill are deterministic execution. (4) No resolver, adapter, or model harness gained domain
logic. (5) The preflight is universal because it prevents duplicate work; the explicit override is
conditional on an intentional refresh. (6) Verdict: ALIGNED. README, startup/resolver wiring, and
semantic memory were checked; README and semantic memory were updated, while startup and resolver
wiring required no change.
## Q/I/A/V screening score, lanes, and act-now rule (2026-08-14)
**Why accepted:** Screening decided pursue/strategy but gave no defensible apply order, and a
single scalar score hides why a job ranked where it did. The user's coaching input (candidate-
market-fit layers) and application history support separating qualification from interest, and
letting access compensate for a lower qualification score once hard gates pass.

**Implications:** `job-screening.md` now defines a four-axis tuple — Q (qualification), I
(interest), A (access, 0–4), V (value) — plus a separate low-confidence PV platform-visibility
flag, with written anchors. Base lanes (Focus / Stretch / Qualified) derive from Q and I; ACT-NOW
is the sole access-based lane exception. Rank within a lane is an additive `screenChanceIndex`
(Q + A, no interaction term; an index, not a calibrated probability) times a freshness multiplier
times value, giving a 0–130 `rankIndex`.
An act-now rule surfaces gate-passed, high-interest jobs with warm access at the top of their
lane; when Q < 4 it places them in Stretch as an explicit exception, and hard gates are never
overridden. The compact record lives in the existing `lifecycle.priority` string, including PV,
the freshness multiplier, and the scoring date; freshness goes stale and is recomputed at each
application session. Every gate pass persists a compact pass basis with named assumptions in the
screen reason. **This documents a scoring method, not a ranking capability:** the board renders
the priority string but does not parse, sort, or group by it; queue assembly stays manual, and a
deterministic rank command is considered only after anchors survive validation. Company history
is stored as facts plus a relationship wrap-up in a profile-local `company-history.md` with a
categorical summary feeding the A anchor; facts and inference are kept distinct, and any
restriction carries an explicit scope (company / business unit / team / role family / person)
and blocks only within it. Recorded assumptions: additive access and starting weights, revisited
only through the validation protocol. The completed historical pass remains the frozen `r1`
baseline; revision `r2` uses the prospective protocol below. Design constraint: a job must be
scoreable in about five minutes; decisive unknowns become `needs_input`, never silent passes.

**Architecture Boundary verdict (2026-08-14): ALIGNED.** (1) No judgment moved into code; the
method is markdown consumed via the existing `job_screening` resolver route. (2) All scoring
judgment stays in the skill doc; candidate taste stays in profile files. (3) No new deterministic
tooling was added; the record reuses `lifecycle.priority`. (4) No resolver, adapter, or model
harness changed. (5) No new scheduled or universal workflow friction. (6) Verdict: ALIGNED.

## Prospective validation and qualification-anchor revision r2 (2026-08-14)
**Clarifies:** Q/I/A/V screening score, lanes, and act-now rule (2026-08-14).

**Why accepted:** The first 16-case historical pass compressed every gate-passing role into Q8–10,
so Q measured whether a transfer story could be told more than how direct the evidence was. The
same pass showed that A2 reaching a human process was partly definitional because each A2 case
entered through a recruiter or referral. A second historical holdout would remain contaminated by
familiar outcomes; new discoveries provide a cleaner blind-by-construction cohort.

**Implications:** Qualification revision `r2` grades recent evidence at the requested altitude,
direct core-customer/commercial context, and the number of non-gating requirements that rely on
transfer assumptions. Weights and lane thresholds do not change, and the frozen historical
worksheet remains `r1`. New priority strings carry the scoring revision. Prospective validation
records `stageAtScore` and `maxStageAfterScore` separately so pre-existing access is not counted as
new progress, keeps terminal outcome and relationship residue separate, waits for about 15 resolved
or sufficiently mature cases, and prohibits anchor or weight changes mid-cohort.

**Architecture Boundary verdict (2026-08-14): ALIGNED.** Judgment remains in
`job-screening.md`; cohort evidence remains profile-local. No schema, resolver, board parser,
ranking command, or deterministic screening logic was added.
## Incremental discovery boundary (2026-08-14)
**Why accepted:** A rolling 24-hour LinkedIn window is not the same as discovering jobs since the
previous successful sweep, and LinkedIn can surface older promoted listings even inside a recency
filter.

**Implications:** `search-linkedin-jobs.mjs` accepts an explicit `--since` timestamp. Incremental
discovery uses the stored previous-success boundary, verifies page-level posting dates, deduplicates
by job ID, and advances the heartbeat only after reconciliation.

**Architecture Boundary verdict (2026-08-14): ALIGNED.** (1) No job-fit judgment moved into code.
(2) Judgment remains in `job-screening.md`; candidate observations remain profile-local. (3)
`--since` is deterministic search-window plumbing. (4) No resolver or model harness changed. (5)
The option is used only for incremental discovery. (6) Verdict: ALIGNED.

## Incremental job-search sweep is a thin orchestration skill (2026-08-21)

**Why accepted:** A recurring sweep spans discovery, exact identity, employer-page verification,
screening, queue freshness, and reporting. Leaving the sequence implicit caused inconsistent
boundary handling and encouraged agents to reconstruct logic already owned by scripts and the
screening method.

**Implications:** `job-search-sweep.md` owns the transaction sequence and completion gate only. The
`job_search_sweep` resolver route loads it with `job-screening.md`. Search, identity extraction,
duplicate stopping, fit judgment, lifecycle transitions, prospective score freezing, and board
rendering remain in their existing owners. Non-mutating staging uses `process-job.mjs --no-save`.
LinkedIn recency results are candidates only; a target listing dated before the saved boundary is
reported but not admitted unless backlog recovery is explicitly requested. A small deterministic
finalizer locks the discovery boundary, compares it with the value read at startup, rejects
regression or concurrent completion, and atomically writes the run start as epoch milliseconds.
Freshness-only reprioritization remains report-only because the existing screen command has broader
side effects.

**Architecture Boundary verdict (2026-08-21): ALIGNED.** (1) Candidate-specific taste stays in the
profile. (2) The sweep adds no scoring judgment and refers to `job-screening.md`. (3) Existing
deterministic owners are composed; code adds only non-saving inspection policy and atomic boundary
finalization. (4) The resolver gains only a document route, with no model policy or domain logic.
(5) The workflow runs only for an explicit sweep request. (6) Verdict: ALIGNED. README,
`resume-os.md`, resolver docs/tests, and semantic memory were updated.

## Evidence-grounded interview post-processing (2026-08-22)
**Why accepted:** Interview transcripts carried useful information about next steps, role scope,
and repeat question themes, but earlier learning was dispersed in application packages and could
easily turn a polite response, silence, or a rejection into unsupported performance feedback.

**Implications:** The resolver-routed `interview-postmortem.md` keeps raw transcripts immutable,
requires a distinction between direct evidence, self-observation, and inference, and records
portable evidence in a profile-local ledger. It treats question-bank promotion as selective, not
automatic, and separates contact decisions from transcript analysis. Transcript and ledger content
remain profile-local; the engine contains only the reusable method and source-name convention.

**Architecture Boundary verdict (2026-08-22): ALIGNED.** (1) The change introduces interview
interpretation and learning judgment. (2) That judgment lives in markdown. (3) Resolver lookup is
the only deterministic execution change. (4) The resolver adds a document route without domain
logic. (5) The workflow runs after a substantive conversation, not for every job. (6) Verdict:
ALIGNED.

## Interview preparation reuses bounded interview evidence (2026-08-22)
**Why accepted:** A postmortem can improve a later interview only if the preparation workflow sees
its transferable evidence. Leaving the question bank and evidence ledger outside the prep route
would make their use inconsistent.

**Implications:** `interview_prep` loads the interview method, profile question bank, and profile
evidence ledger with the general resume guidance. The preparation remains package-specific and
must cite why a prior lesson applies; it does not reuse old stories or company facts by default.

**Architecture Boundary verdict (2026-08-22): ALIGNED.** (1) The change adds preparation judgment.
(2) That judgment remains in markdown. (3) Resolver lookup changes only the document set. (4) No
adapter or harness gains domain logic. (5) The route runs only for interview preparation. (6)
Verdict: ALIGNED.
