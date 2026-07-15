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
