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
  `bullet-rubric.md`, `eval-rubric.md`), `resume-os.config.json`, `engine/` (config loader,
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
  submit (computer-use, designed seam only, not built).
- **Email-event sync:** `scripts/run-gmail-sync.sh` resolves the active profile work directory,
  substitutes that single authoritative path into the read-only Gmail monitor prompt, enforces a
  per-run output contract, and records a heartbeat. `scripts/import-events.mjs` deduplicates and
  imports valid events, quarantines malformed output, archives processed files, and regenerates
  the job board.
- **Daily brief:** `scripts/run-daily-brief.sh` + `prompts/daily-brief.txt` (PR #2). A read-only
  agent (models.json `daily_brief`) narrates deterministic facts — verbatim board health warnings,
  status counts, raw monitor events deduped by message_id across the overlapping search window —
  into a Telegram digest delivered via `hermes send` (no LLM). Wrapper owns the heartbeat (written
  only after delivery) with failure categories agent_failed / brief_output_missing /
  delivery_failed / no_send_target / input_invalid; board is validated before any model call;
  `BRIEF_SEND_TARGET` is required, never defaulted. Scheduled by LaunchAgent
  `ai.resumeos.dailybrief` (07:30, machine config outside the repo).
- **Resolver:** `engine/resolver.json` (routing table) + `engine/resolve.mjs` (lookup) +
  `scripts/test-resolver.mjs` (deterministic test). Task type -> which skill docs to load,
  with a default/fallback route. `adapters/claude-code-bootstrap.md` is the Claude Code entry.
- **Models:** `engine/models.json` maps pipeline steps to model ids. Schema/IDs only, no
  runtime binding. **Audit rule:** models.json is the declared dictionary; actuals are recorded
  per run (heartbeat JSON `model` field, run logs). Any runner/model swap MUST update models.json
  in the same change — declared vs actual drift is a bug (a first sync run silently used the
  expensive CLI default model before the pin; that class of drift is what this rule prevents).
- **High-fit tailoring hierarchy:** Before editing, identify 1–2 dominant evidence stories and
  place them in the first two bullets of the most relevant recent role. High-fit, ambiguous,
  referral, and high-stakes `strategy.md` files include a Requirement-to-Evidence & Visibility
  table, which reports whether consequential proof is top-of-page, buried, skills-only, or absent.
  `keywords.md` records the verified claim boundary for adjacent evidence. Bolding prioritizes
  target-role relevance over metric size. See `tailoring-methodology.md` and DECISIONS.md
  (2026-07-15).
- **Conditional skills-first layout:** `build-resume-formats.mjs --skills-first` deterministically
  renders the Skills section below the headline instead of after Selected Projects. The tailoring
  ship check may compare this layout only when rendered page one has a conspicuous avoidable void;
  it is kept only after the two-page gate, scorer, six-second scan, and visual checks all pass, and
  the same flag must be carried into `--deliver`. Default section order remains unchanged.
- **Architecture publication check:** Before publishing a tracked engine change, agents run the
  six-question Architecture Boundary review in `resume-os.md` and record `ALIGNED` or link a
  `DECISIONS.md` exception. This is intentionally a brief manual check, not a hook or CI system.
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
- **Asynchronous LinkedIn assessment:** `scripts/assess-jobs.mjs` is a zero-local-model worker that
  assesses at most one recent `to_review` / `to_apply` job per invocation, caps initial throughput at
  five jobs per local day, retries at most three times, reclaims `running` attempts after ten
  minutes, and records canonical state in the job's `metadata.json`. `engine/linkedin-lock.mjs`
  serializes discovery and assessment access to the shared Chrome profile. Explicit LinkedIn
  checkpoint/auth-wall signals create profile-local `work/linkedin-stop.json`; clearing it is
  manual. Every invocation writes `work/heartbeats/linkedin-assessment.json`, including no-op and
  per-job-failure runs. The machine LaunchAgent is `ai.resumeos.assess` at a five-minute cadence;
  installation/loading remains machine-local.

## Session hygiene (every session, not just dedicated resume-OS boots)

- **Queue hygiene:** all staging queues are pending-only. Terminal outcomes leave the queue and
  write durable information once at the canonical destination; do not preserve parallel graduated
  or resolved lists. See the Core Rules in `resume-os.md`.
- **Due reviews:** on session start, check the active profile's `review-schedule.md`; if any
  review's "Next due" ≤ today, surface it to the user before other work. (Previously this check
  lived only in `cold-start-prompt.md`, so ordinary sessions missed overdue reviews for weeks.)
- **Craft learnings:** session-learned craft judgment (resume/cover-letter/outreach/review craft)
  is NOT appended to engine skill docs directly. It goes to the profile-local staging queue
  `profiles/<id>/craft-candidates.md` (admission rules + session-end prompt are in that file's
  header); promotion into skill docs happens only at human-approved triage. Profile taste goes to
  the profile's `LEARNINGS.md`. The file is optional per profile: if absent, the session-end
  check is a no-op — create it on the first qualifying entry by copying
  `profiles/example/craft-candidates.md`. Tailoring Phase 0 loads the optional profile
  `LEARNINGS.md`; promoted engine rules land directly in the applicable methodology/rubric step,
  not in a duplicate Pitfalls appendix. See DECISIONS.md (2026-07-17).

## Planning

- **Single canonical planning doc: `os-planning/backlog-horsepower-and-reuse.md`** (stories with
  My proposal / Your decision columns, LLM job map, evals, build sequence; external review merged
  2026-07-12). Superseded planning docs live in `os-planning/archive/`. Do not create parallel
  planning docs; extend the canonical one.
- Pipeline health is zero-LLM by rule: heartbeats are files under `work/` (discovery uses
  `.linkedin-last-checked` at repo root), the board renders staleness warnings (`job-board.mjs`),
  and `scripts/check-heartbeats.mjs` + LaunchAgent `ai.resumeos.watchdog` fire local macOS
  notifications. No model call may enter the watch path (it must not share failure modes with
  the agents it watches, e.g. API credit exhaustion).

## Key file locations

- Config: `resume-os.config.json` (machine/env), `profiles/<id>/profile.json` (identity).
- Schema: `engine/schemas/profile.schema.json`.
- Template/presentation: `engine/templates/resume-template.mjs` (CSS + HTML skeleton; restyle here).
- Build/score: `scripts/build-resume-formats.mjs`, `scripts/score-resume.mjs`.
- Pipeline: `scripts/job-board.mjs`, `import-events.mjs`, `enrich-job.mjs`, `process-job.mjs`,
  scrapers (`search-linkedin-jobs.mjs`, `fetch-linkedin-job.mjs`).

## Common workflows

- Build a base: `node scripts/build-resume-formats.mjs --source resume.md --export`.
- Render board: `node scripts/job-board.mjs render`. Resolver test: `node scripts/test-resolver.mjs`.
- New profile: create `profiles/<id>/` like `profiles/example/`, set `activeProfile`.

## Maintenance gotchas

- **Parity bar is visual/text, not byte:** Chrome PDFs differ on metadata. Compare filenames,
  page count, extracted text, PNG within tolerance, and the `score-resume.mjs` scorecard.
- **Gitignore negation:** to track only the demo profile, use `profiles/*` then
  `!profiles/example/` (a bare negation under an ignored dir does not work).
- **Root working-state must never be tracked.** `inbox/`, `events/`, `applications/`,
  `resume-formats/`, `jobs-tracker.md`, `package-queue.md` at the repo root are gitignored.
  Real data lives in `profiles/<id>/work/`. See DECISIONS.md (the public-push leak incident).
- **Root-memory boundary:** `memory/` is engine-only. Candidate job, application, outreach,
  interview, resume-content, and pipeline details live exclusively under `profiles/<id>/`.
- **De-personalization:** engine files must carry zero candidate data. The example profile
  (Jordan Rivera) and fictional company names (Summit Outfitters, Tutorly, Ledgerline,
  Corealign, Vantix, JobForge) are the only "people/companies" in the public engine.
