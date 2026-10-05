# Semantic Memory

Durable knowledge about the Resume OS engine itself: architecture, extension points,
maintenance, and gotchas. Never put candidate/profile data here (that lives under
`profiles/<id>/`, gitignored).

## Project overview

Resume OS is a config-driven engine that separates reusable logic from per-person data.
Skills are plain-markdown judgment docs; `scripts/*.mjs` are deterministic tools; each
candidate lives in `profiles/<id>/` (gitignored except the fictional `profiles/example/`).
Switch profiles via `activeProfile` in `resume-os.config.json` or `RESUME_OS_PROFILE=<id>`.

## Architecture

- **Engine (reusable):** root skill docs (`resume-os.md`, `tailoring-methodology.md`,
  `bullet-rubric.md`, `eval-rubric.md`, `job-screening.md`, `job-search-sweep.md`,
  `application-form-assist.md`), `resume-os.config.json`, `engine/` (config loader,
  schema, templates, resolver, models), `scripts/` (tooling), `adapters/` (runtime entry points).
- **Profiles (per-tenant, private):** `profiles/<id>/` holds `profile.json` (identity/contact/
  ATS answers/routing/positioning, validated by `engine/schemas/profile.schema.json`),
  `sources/`, `base-resumes/`, `work/` (inbox, applications, events, resume-formats, jobs-tracker,
  package-queue), and profile memory (tracker, LEARNINGS, review-schedule, positioning).
- **Config resolution:** all tooling resolves paths through `engine/config.mjs`
  (`workDir`, `baseResumesDir`, `sourcesDir`, `resolveBase`, `fullName`, `timezone`,
  `resolveBrowserPath`). Dual-path: falls back to repo root when a profile dir is absent.
- **Pipeline (the "agents"):** discover/ingest (Hermes scrapers, facts only) -> route ->
  tailor -> score (deterministic gates in `score-resume.mjs` + latent checklist in
  `eval-rubric.md`) -> cover letter -> build/deliver (`build-resume-formats.mjs`) ->
  application form assist (`apply-form-assist.mjs`, browser prep only; human submission remains
  outside the harness).
- **Email-event sync:** `scripts/run-gmail-sync.sh` is the one scheduled Gmail path. Himalaya
  reads a bounded, three-day overlapping IMAP window into a short-lived profile-work snapshot;
  Hermes/OpenAI (`gpt-5.6-terra`) reads only that snapshot and writes one event handoff file.
  The wrapper enforces the output contract and heartbeat, then `scripts/import-events.mjs`
  deterministically deduplicates/imports valid events, quarantines malformed output, archives
  processed files, and regenerates the job board. After a successful import, the deterministic,
  read-only `scan-interview-postmortems.mjs` establishes a first-run baseline then keeps
  `work/runtime/interview-postmortem-scan.json` current for later completed, explicitly scheduled
  interview events that lack a same-day standard-named transcript or postmortem. A later same-stage
  calendar event suppresses the earlier append-only invitation as a reschedule; pending entries
  refresh from current lifecycle metadata, including legacy repo-relative package paths. `--backfill`
  is an explicit historical review, never the scheduled default. It does not infer that a call
  occurred, evaluate it, send messages, or edit packages. LaunchAgent `ai.resumeos.gmailsync` runs at 07:00 and 19:00 local time (machine config outside the repo). Claude and the paused Hermes
  Gmail cron are not active paths; the Codex Gmail connector remains interactive-only.
- **Daily action digest:** `scripts/run-daily-brief.sh` + `prompts/daily-brief.txt`. A deterministic
  gate reads only `Upcoming Events`, `Needs Action`, and `Interviewing`; when all are empty, it
  writes a successful heartbeat without a model call or Telegram message. When work needs attention,
  the read-only `daily_brief` agent composes a concise job-search digest and `hermes send` delivers
  it. Watchdog separately sends only operational failures. The wrapper owns the heartbeat with
  failure categories agent_failed / brief_output_missing / delivery_failed / no_send_target /
  input_invalid; `BRIEF_SEND_TARGET` is required and never defaulted. Its runner order is
  configurable: OpenAI Codex (`gpt-5.6-terra`) is primary and DeepSeek is attempted only after a
  nonzero or blank OpenAI result; the heartbeat records the runner that actually succeeded.
  Scheduled by LaunchAgent `ai.resumeos.dailybrief` (07:30, machine config outside the repo).
- **Resolver:** `engine/resolver.json` (routing table) + `engine/resolve.mjs` (lookup) +
  `scripts/test-resolver.mjs` (deterministic test). Task type -> which skill docs to load,
  with a default/fallback route. `adapters/claude-code-bootstrap.md` is the Claude Code entry.
- **Application form assist:** `application-form-assist.md` owns the judgment/no-submit rules.
  `scripts/apply-form-assist.mjs` is a deterministic Playwright harness that requires the manifest
  to match the active profile, leaves blank optional fields untouched, requires exact select
  matches, confines uploads to one application package, blocks DOM submission and mutating HTTP
  requests, reports required-action failures, and holds the browser for manual review. Real
  manifests/answers are profile-local; the tracked example is fictional.
- **Models:** `engine/models.json` maps pipeline steps to model ids. Schema/IDs only, no
  runtime binding. **Audit rule:** models.json is the declared dictionary; actuals are recorded
  per run (heartbeat JSON `model` field, run logs). Any runner/model swap MUST update models.json
  in the same change — declared vs actual drift is a bug (a first sync run silently used the
  expensive CLI default model before the pin; that class of drift is what this rule prevents).
- **Model comparison:** `evals/model-comparison.md` is the operational runbook and resolver route
  (`model_eval`). Every comparison is task-scoped and uses two layers: deterministic smoke plus exact
  protected identity/contact/link gates, followed by frozen human-vetted resume/bullet cases graded
  PASS/REVIEW/FAIL. Raw outputs and exact model settings are preserved; a factual regression blocks
  a switch, and no runtime/model dictionary change occurs without explicit user approval.
- **High-fit tailoring hierarchy:** Before editing, identify 1–2 dominant evidence stories and
  place them in the first two bullets of the most relevant recent role. High-fit, ambiguous,
  referral, and high-stakes `strategy.md` files include a Requirement-to-Evidence & Visibility
  table, which reports whether consequential proof is top-of-page, buried, skills-only, or absent.
  `keywords.md` records the verified claim boundary for adjacent evidence. Bolding prioritizes
  target-role relevance over metric size. See `tailoring-methodology.md` and DECISIONS.md
  (2026-07-15).
- **Vetted recurring stories:** An optional profile-local `sources/vetted-bullets.md` supplies
  human-approved defaults, lens variants, claim boundaries, and per-story staleness triggers.
  Tailoring consults it before rewriting a matching story and cites the Story ID when material;
  `exhaustive-experience.md` remains fact-authoritative. The 2026-07-21 planned nine-story study
  satisfied recurrence/counterexample review and the user's explicit GO served as human triage,
  allowing four sanitized conditional refinements to enter the active rubric/methodology.
- **LinkedIn outreach templates:** `resume-os.md` holds a small, profile-agnostic template library.
  The initial post-application signal template is a concise, no-ask note for relevant hiring-side
  contacts; both evidence phrases must be backed by the current application package. New templates
  enter only through a profile-local craft candidate and explicit human approval.
- **Contact opportunity assessment:** `tailoring-methodology.md` Phase 4 includes a focused-application
  lifecycle check that asks whether contact is warranted before applying, after applying, after
  recruiter screens/interviews, while waiting, and after rejection/close. Opportunistic applications
  skip it unless the user explicitly requests the check or the application is re-screened as focused.
  It produces a decision record only; `Recommend draft` does not authorize message copy. Pre-submit
  records may live in the package, while later-stage records go in profile-local
  `inbox/<job-id>/contact-log.md` so submitted packages stay frozen. Contact claims must come from the
  package, interview transcript, recruiter email, or explicit user input.
- **Protected resume identity/contact/links:** `engine/resume-protected-facts.mjs` deterministically
  validates the Markdown heading, exact profile-owned contact-block lines, required contact links,
  an allowlist of every HTTP(S) URL, and conditional project/credential links from the active profile.
  Both `score-resume.mjs` (HARD gate) and `build-resume-formats.mjs` (fail before render/delivery)
  enforce it. Profile `contact.links` are required in the contact block; `resumeLinks` defines
  canonical conditional URLs.
- **Conditional skills-first layout:** `build-resume-formats.mjs --skills-first` deterministically
  renders the Skills section below the headline instead of after Selected Projects. The tailoring
  ship check may compare this layout only when rendered page one has a conspicuous avoidable void;
  it is kept only after the two-page gate, scorer, six-second scan, and visual checks all pass, and
  the same flag must be carried into `--deliver`. Default section order remains unchanged.
- **Architecture publication check:** Before publishing a tracked engine change, agents run the
  six-question Architecture Boundary review in `resume-os.md` and record `ALIGNED` or link a
  `DECISIONS.md` exception. The same pass verifies `README.md`, agent startup/resolver wiring, and
  this semantic memory; update affected surfaces or explicitly confirm that no change is needed.
  This is intentionally a brief manual check, not a hook or CI system.
- **Interview post-processing:** `interview-postmortem.md` is a resolver-routed judgment skill for
  completed interview, recruiter, and contract-scope conversations. It preserves immutable source
  transcripts, separates direct evidence from self-observation and inference, records only useful
  next-step and reusable-question evidence in a profile-local ledger, and does not infer performance
  failure from silence or rejection. Future source names use
  `interview-transcript-YYYY-MM-DD-<stage>-<counterpart>.md`; historical files stay untouched. For
  multi-stage processes, its validation check is whether an earlier call changed the next stage's
  preparation, not whether a later outcome can be attributed to one answer. The `interview_prep`
  route loads the method with the profile-local question bank and evidence ledger so recurring
  learning validates recruiter, hiring-manager, functional, technical, panel, and case preparation.
  The scheduled scanner only identifies a missing source or review; interpretation and any prep
  update remain inside the judgment workflow.
- **LinkedIn job signals:** `process-job.mjs` delegates personalized-signal detection to
  `engine/linkedin-job-signals.mjs`. A top-applicant result is true only for an exact visible claim
  scoped to the current job detail; recommendation-card claims are rejected, unverifiable pages
  record `unknown`, and target-card posting age is persisted as `postedAt` / `postedTimeAgo`.
  LinkedIn Premium may hide match results behind a dynamically generated, virtualized "Show match
  details" panel; ordinary discovery records `unknown` when that panel is available but not
  captured, rather than inventing `false`. `--assess-match` is an explicit diagnostic mode, not a
  bulk-discovery default. **Hard boundary:** standard discovery/ingestion remains deterministic DOM
  parsing with zero LLM/model calls and does not invoke LinkedIn's AI match flow. Explicit
  `--assess-match` verification may request that flow for a shortlisted job, then reads the
  completed result from Chrome's accessibility tree without a local LLM or vision model. It records
  `jobMatchLevel` (`top_applicant`, `high`, `medium`, or `low`) plus the required-qualification
  count, and anchors acceptance to the completed qualification block so recommendation cards cannot
  contaminate the target result. Uncaptured results remain `unknown`.
  `scripts/test-linkedin-job-signals.mjs` covers contamination and dates.
- **Incremental LinkedIn discovery:** use
  `node scripts/search-linkedin-jobs.mjs --since <ISO timestamp>`; verify page-level posting dates
  because LinkedIn can return older promoted listings inside a recency-filtered result, deduplicate
  by job ID, and advance `.linkedin-last-checked` only after the sweep is successfully reconciled.
- **Incremental job-search sweep:** The `job_search_sweep` resolver route loads
  `job-search-sweep.md` plus `job-screening.md`. The sweep doc owns only orchestration: saved-boundary
  handling, out-of-window rejection, exact-identity reconciliation, official-page verification,
  screening composition, queue freshness refresh, and lane-grouped reporting. Search, identity,
  scoring, lifecycle, prospective freezing, and rendering remain with their existing owners.
  Candidate staging uses `process-job.mjs --no-save`; successful runs finalize the epoch-millisecond
  boundary atomically with `finalize-linkedin-discovery.mjs`, which rejects concurrent changes and
  regressions. Freshness-only queue recalculation is report-only until a safe priority-only command
  exists.
- **Company exclusions:** Profile-specific `jobSearch.excludedCompanies` entries are normalized and
  enforced deterministically before LinkedIn search results are emitted, before a fetched job is
  persisted, before the asynchronous assessment worker selects a job, and before the package queue
  is generated. The reusable engine does not hardcode tenant-specific company preferences.
- **Upcoming events:** Gmail event imports accept `next_event_at` only when an event supplies an exact
  future UTC timestamp for a recruiter screen or interview. The importer persists the earliest valid
  value as lifecycle `nextEventAt`; the board and daily brief render it as an upcoming event. Vague
  scheduling language remains blank rather than being inferred.
- **Exact job identity and ingestion deduplication:** Job metadata stores `linkedinJobId` separately
  from the employer's `employerRequisitionId` and its scoped `employerRequisitionSource`.
  `process-job.mjs` checks existing records before launching Chrome when the LinkedIn ID or URL is
  available, checks the employer requisition immediately after extracting the apply URL, and stops
  before saving a duplicate. Screenability uses the same precedence: LinkedIn ID, employer-scoped
  requisition ID, then canonical URL. Company/title similarity is not an identity key, so multiple
  roles or distinct requisitions at one company stay separate. Legacy metadata remains comparable
  because identities can be derived from stored URLs; `backfill-job-identities.mjs --apply`
  persists the explicit fields. `--allow-existing` permits intentional refreshes and the existing
  on-demand signal-assessment path.
- **Gmail event matching:** An explicit tracker job ID takes precedence. Company + title remains a
  fallback only when it identifies one row; multiple matches are routed to review without mutating
  any job. A Gmail placeholder never redirects to another posting merely because one row is not a
  placeholder.
- **Evaluation collection boundary:** Frozen private labels, cases, raw outputs, and scorecards are durable evaluation evidence. One-off collection interfaces are removed after use unless a recurring workflow and explicit owner exist; do not parameterize profile-specific sampling logic into the engine merely to preserve a temporary aid.
- **Screening lifecycle:** `lifecycle.status` is execution state, while screening records `pursue`
  (`apply`, `skip`, `needs_input`) independently from material `strategy` (`base_resume`, `tailor`).
  `job-board.mjs screen` validates that only `apply` receives a strategy; it moves `apply` to
  `to_apply`, `skip` to `skipped`, and leaves `needs_input` in `to_review` with one focused question.
  Apply routes may also carry `applicationMode` (`focused` or `opportunistic`); opportunistic is base-resume-only and excluded from package, tailoring, outreach, and priority work. Tailored routes require explicit `approve-tailor` approval before package-queue entry; re-screening clears it. `screenQuestion` preserves the one focused needs-input question, while `migrate-screening --apply` explicitly returns legacy unscreened rows to review. Legacy `fit` tiers normalize to the new fields for compatibility.
- **Screening scoring method (documented, not yet a ranking capability):** `job-screening.md`
  defines the Q/I/A/V tuple (qualification, interest, access 0–4, value) plus a separate PV
  platform-visibility flag, versioned anchor rubrics, base lanes from Q and I (Focus / Stretch /
  Qualified) plus the explicit ACT-NOW access exception, an additive `screenChanceIndex` (not a calibrated probability) with a freshness
  multiplier yielding a 0–130 `rankIndex`, and an act-now rule: warm access + I ≥ 7 tops its lane
  and, when Q < 4, enters Stretch as an explicit exception (hard gates never overridden). The
  compact record is a `lifecycle.priority` string like `F-58 r2 (Q8 I9 A2 V4 PV1 f1.0 @2026-08-14)`;
  **the board displays this string but does not parse, sort, or group by it** — v1 queue assembly is
  manual, and a deterministic rank command comes only after anchors survive validation. Every gate
  pass persists a compact pass basis with named assumptions in the screen reason. Company process
  facts and relationship wrap-ups live profile-locally in `company-history.md`; restrictions carry
  a scope and block only within it. Validation is prospective after the frozen `r1` retro baseline.
- **Asynchronous LinkedIn assessment:** `scripts/assess-jobs.mjs` is a zero-local-model worker that
  assesses at most one recent `to_review` / `to_apply` job per invocation, caps initial throughput at
  five jobs per local day (with a validated `LINKEDIN_ASSESS_DAILY_CAP` command-level override for
  controlled batches), retries at most three times, reclaims `running` attempts after ten
  minutes, and records canonical state in the job's `metadata.json`. `engine/linkedin-lock.mjs`
  serializes discovery and assessment access to the shared Chrome profile. Explicit LinkedIn
  checkpoint/auth-wall signals create profile-local `work/linkedin-stop.json`; clearing it is
  manual. Every invocation writes `work/heartbeats/linkedin-assessment.json`, including no-op and
  per-job-failure runs. **Assessment is pull-based, not scheduled:** `--job-id` targets one job so it
  runs as a screening step when a human is deciding to invest, and the `ai.resumeos.assess`
  LaunchAgent is unloaded. Targeting does not bypass eligibility — the stop file, lock, daily cap,
  and LinkedIn-URL guard all still apply. The heartbeat records `cadenceMinutes: 0`, which marks a
  workflow on-demand so `check-heartbeats.mjs` does not report staleness for something nothing
  schedules. **If the sweep is ever re-enabled, restore a non-zero cadence in the same change**, or
  the watchdog will silently stop noticing that the sweep died.

## Session hygiene (every session, not just dedicated resume-OS boots)

- **Queue hygiene:** all staging queues are pending-only. Terminal outcomes leave the queue and
  write durable information once at the canonical destination; do not preserve parallel graduated
  or resolved lists. See the Core Rules in `resume-os.md`.
- **Due reviews:** on session start, check the active profile's `review-schedule.md`; if any
  review's "Next due" ≤ today, surface it to the user before other work. (Previously this check
  lived only in `cold-start-prompt.md`, so ordinary sessions missed overdue reviews for weeks.)
- **Craft learnings:** ad-hoc session-learned craft judgment (resume/cover-letter/outreach/review
  craft) is NOT appended to engine skill docs directly. It goes to the profile-local staging queue
  `profiles/<id>/craft-candidates.md` (admission rules + session-end prompt are in that file's
  header); promotion into skill docs happens only at human-approved triage. A planned, documented
  study may itself serve as the staging artifact when it predefines recurrence/counterexample gates,
  meets them across distinct outputs, sanitizes the rule, and the user explicitly approves promotion
  as triage; record that exception/clarification in `DECISIONS.md`. Profile taste goes to
  the profile's `LEARNINGS.md`. The file is optional per profile: if absent, the session-end
  check is a no-op — create it on the first qualifying entry by copying
  `profiles/example/craft-candidates.md`. Tailoring Phase 0 loads the optional profile
  `LEARNINGS.md`; promoted engine rules land directly in the applicable methodology/rubric step,
  not in a duplicate Pitfalls appendix. See DECISIONS.md (2026-07-17 and 2026-07-21 clarification).

## Planning Policy

- No planning documents are tracked. `os-planning/` is local scratch only; do not create a canonical
  backlog, roadmap, ticket list, or phased plan in the repository. Select work from current evidence
  and explicit user direction. Durable decisions belong in `DECISIONS.md`; shipped behavior belongs
  here; stable operating rules belong in the skill docs.
- Pipeline health is zero-LLM by rule: heartbeats are files under `work/` (discovery uses
  `.linkedin-last-checked` at repo root). `scripts/check-heartbeats.mjs` is the sole authority for
  health thresholds and writes `work/watchdog-health.json` on every completed run. Each assertion
  expires after two scheduled watchdog intervals; `job-board.mjs` renders its result verbatim and
  flags only an expired watchdog assertion rather than re-evaluating workflow staleness. LaunchAgent
  `ai.resumeos.watchdog` fires local notifications and optional, bounded Telegram failure alerts.
  No model call may enter the watch path (it must not share failure modes with the agents it watches,
  e.g. API credit exhaustion).

## Key file locations

- Config: `resume-os.config.json` (machine/env), `profiles/<id>/profile.json` (identity).
- Schema: `engine/schemas/profile.schema.json`.
- Template/presentation: `engine/templates/resume-template.mjs` (CSS + HTML skeleton; restyle here).
- Build/score: `scripts/build-resume-formats.mjs`, `scripts/score-resume.mjs`.
- Pipeline: `scripts/job-board.mjs`, `import-events.mjs`, `enrich-job.mjs`, `process-job.mjs`,
  scrapers (`search-linkedin-jobs.mjs`, `fetch-linkedin-job.mjs`).

## Common workflows

- Build a base: `node scripts/build-resume-formats.mjs --source resume.md --export`.
- Dry-run form assist: `RESUME_OS_PROFILE=example node scripts/apply-form-assist.mjs --manifest profiles/example/work/application-form-example.json --dry-run`.
- Render board: `node scripts/job-board.mjs render`. Resolver test: `node scripts/test-resolver.mjs`.
- New profile: create `profiles/<id>/` like `profiles/example/`, set `activeProfile`.

## Maintenance gotchas

- **Agent-memory runtime boundary:** Claude Code owns the tracked stop/preprompt hooks in
  `.claude/settings.json` and `hooks/`. Codex loads the same memory system through tracked
  `AGENTS.md` instructions; a copied `.codex/hooks.json` using `$CLAUDE_PROJECT_DIR` is invalid and
  causes repeated stop-hook exit 127 failures.
- **Parity bar is visual/text, not byte:** Chrome PDFs differ on metadata. Compare filenames,
  page count, extracted text, PNG within tolerance, and the `score-resume.mjs` scorecard.
- **Gitignore negation:** to track only the demo profile, use `profiles/*` then
  `!profiles/example/` (a bare negation under an ignored dir does not work).
- **Root working-state must never be tracked.** `inbox/`, `events/`, `applications/`,
  `resume-formats/`, `jobs-tracker.md`, `package-queue.md` at the repo root are gitignored.
  Real data lives in `profiles/<id>/work/`. See DECISIONS.md (the public-push leak incident).
- **Profile-relative lifecycle paths:** Values such as `lifecycle.packagePath` are relative to the
  active profile's `work/` directory unless absolute. Consumers such as the package-queue builder
  must resolve them through `workDir()`, not against the repository root.
- **Root-memory boundary:** `memory/` is engine-only. Candidate job, application, outreach,
  interview, resume-content, and pipeline details live exclusively under `profiles/<id>/`.
- **De-personalization:** engine files must carry zero candidate data. The example profile
  (Jordan Rivera) and fictional company names (Summit Outfitters, Tutorly, Ledgerline,
  Corealign, Vantix, JobForge) are the only "people/companies" in the public engine.

## Scheduled pipeline repair (2026-09-30)

- LinkedIn search supports current component-key job cards and legacy cards, rejects
  authentication checkpoints, and does not mistake detail-pane links for search results.
- `run-linkedin-discovery.mjs` owns scheduled last-24-hour search, exact ingestion,
  board rendering, boundary finalization, and an eight-hour contract heartbeat. Hermes
  script exit status owns success; enrichment judgment remains in the existing skill,
  using the declared `discovery_enrich` model. It never widens a stale boundary into
  historical catch-up. A persistent `work/linkedin-stop.json` blocks scheduled search;
  search/detail auth challenges create the stop and abort the run immediately, without
  boundary advancement. Manual verification and explicit stop removal are required
  before resuming. Enrichment failures are reported without blocking other jobs.
- Gmail supports an explicit binary/account and bounded recovery dates. Himalaya 1.2's
  installed email-lib pagination repeats the first page, so fetch bounded headers with
  page-size zero, cap bodies, and fail on overflow. Recovered older events append evidence
  without regressing newer lifecycle state. Transition freshness is recorded separately
  as `lifecycle.stateChangedAt` (including manual applied/skip/outcome commands), with
  appliedAt and legacy/manual contact dates retained as floors. Informational mail
  updates lastContactAt but does not suppress a still relevant older interview; newer
  state-changing email, including terminal rejection, continues to block regressions.
- Architecture Boundary: ALIGNED. No domain judgment added to code; deterministic
  execution and verification compose existing identity, enrichment, lifecycle, rendering,
  and boundary owners. Resolver/adapter routing unchanged; README/model dictionary updated.

- **Job email visibility:** Imported events preserve subject, sender, evidence, and notes. Actionable board rows show the newest dated email details and its Gmail link. Undated recovery entries do not displace dated events. Generic recruiter subjects mentioning a chat or availability are included in the mailbox shortlist.
