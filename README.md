# Resume OS v2

A reusable engine for resume tailoring, job-pipeline tracking, and application packaging.
The reusable engine is profile-agnostic; each person's private data lives under `profiles/<id>/`.

## Repository layout

- **Engine (reusable, shareable):**
  - `resume-os.md`, `tailoring-methodology.md`, `bullet-rubric.md`, `eval-rubric.md`,
    `job-screening.md`, `job-search-sweep.md`, `application-form-assist.md`, `interview-postmortem.md`: skill docs
    (judgment/process).
  - `resume-os.config.json`: machine/env config: `activeProfile`, timezone, browser path, variant→title map.
  - `engine/config.mjs`: config + profile resolver (used by all tooling).
  - `engine/schemas/profile.schema.json`: the per-tenant data contract.
  - `scripts/*.mjs`: deterministic tooling (job board, scoring, building, scraping).
- **Profiles (private, per-tenant, gitignored except `profiles/example/`):** `profiles/<id>/`
  - `profile.json`: identity, contact, ATS answers, base-routing, positioning (validated by the schema).
  - `sources/`: exhaustive experience, skills bank, LinkedIn draft, and optional human-vetted bullet bank.
  - `base-resumes/`: `resume.md`, `resume-pm.md`, … (the living base resumes).
  - `work/`: generated/pipeline state: `inbox/`, `applications/`, `events/`, `resume-formats/`,
    `jobs-tracker.md`, `package-queue.md`.
  - `resume-project-tracker.md`, `LEARNINGS.md`, `craft-candidates.md`, `review-schedule.md`,
    `positioning.md`: profile memory and staged profile-local judgment.

The active profile is `resume-os.config.json` → `activeProfile`. Tooling resolves every profile path
through `engine/config.mjs`, with the repo root as a fallback (so a profile whose data still sits at root
keeps working). Bare filenames in the skill docs (e.g. `resume.md`, `exhaustive-experience.md`) resolve
within the active profile.

## Start here (agents)

1. `resume-os.md`: stable operating model and file roles (engine).
2. `tailoring-methodology.md`: the tailoring engine: phased process, scoring, export (engine).
3. `profiles/<activeProfile>/resume-project-tracker.md`: current state and locked decisions (profile).
4. `profiles/<activeProfile>/LEARNINGS.md`: durable profile-specific judgment and taste (profile).
5. `profiles/<activeProfile>/review-schedule.md`: recurring reviews that may be due (profile).

Session-learned resume, cover-letter, outreach, or review craft does not go directly into the
engine skill docs. When an observation passes the admission test in
`profiles/<activeProfile>/craft-candidates.md`, stage it there for human-approved triage. The file
is optional; copy `profiles/example/craft-candidates.md` on the first qualifying entry.

If these conflict, prefer the profile tracker for current state, `resume-os.md` for stable rules,
and `tailoring-methodology.md` for package-building procedure.

## Hard rules

- Do not hand-edit `work/jobs-tracker.md`; it is generated from `work/inbox/<job-id>/metadata.json`.
- Use `node scripts/job-board.mjs` for lifecycle changes.
- Ingestion checks the LinkedIn job ID first, employer requisition ID second, and canonical URL
  third. Similar titles at the same company remain separate when their requisitions differ.
- Do not update submitted application packages unless explicitly reopened.
- Build application PDFs with `scripts/build-resume-formats.mjs`; do not copy random export artifacts.
- Resume identity/contact/link values are profile-owned hard gates. The scorer and builder reject a
  changed name or exact contact block, a missing required contact/project/credential link, or a
  non-canonical URL before shipping.
- Hermes/scrapers provide facts only. Tailoring agents own base-resume choice, keywords, fit, and judgment.
- **All working data goes under `profiles/<activeProfile>/work/`** (job inbox, events, applications, generated resumes, tracker, package queue). Never write these to the repo root; root copies are gitignored and ignored by the tooling. This applies to every agent and external job (scrapers, Gmail monitor, job discovery).
- Company exclusions belong in the active profile's `jobSearch.excludedCompanies`. Matching is
  normalized but exact; discovery, ingestion, and asynchronous assessment all enforce the list.
- Lifecycle `packagePath` values are relative to the active profile's `work/` directory unless
  absolute. Pipeline readers must resolve them there.

## Common commands

LinkedIn setup uses a dedicated local Chrome profile. Run
`node scripts/save-linkedin-cookies.mjs`, sign in manually in that window, then close
it before running `node scripts/search-linkedin-jobs.mjs --dryrun`.
The search parser supports both legacy and current job cards. A login/checkpoint
error requires manual verification; a parsing/script error is not evidence of a
bot block. Do not repeatedly retry a CAPTCHA or security checkpoint.
`node scripts/run-linkedin-discovery.mjs` runs scheduled discovery for the past
24 hours only, ingests exact new jobs, and delegates factual enrichment to the
existing skill. Search/ingestion failures exit nonzero and do not advance the
discovery boundary. A persistent `work/linkedin-stop.json` prevents scheduled search;
search or job-detail authentication challenges create that stop and abort the run
immediately. Complete manual verification and explicitly clear the stop before
resuming. Individual enrichment failures remain visible in its report.

Gmail schedules may set `HIMALAYA_BIN` to an OAuth2-capable binary and
`HIMALAYA_ACCOUNT` to the intended account. Explicit recovery may set
`GMAIL_SEARCH_AFTER`, `GMAIL_SEARCH_BEFORE`, and `GMAIL_MAX_MESSAGES` (maximum 50).
Normal runs retain the three-day overlap. Header retrieval uses a bounded window
without pagination to avoid the installed Himalaya 1.2 pagination bug; a message
limit overflow fails visibly instead of dropping emails. Older recovered events
are retained without overwriting newer lifecycle state. Informational mail updates
contact freshness without blocking an older, still relevant interview invitation.
`stateChangedAt` records lifecycle transitions, including manual board commands;
newer terminal outcomes and the manual application date remain protected.

```bash
# Paths resolve within the active profile (resume-os.config.json → activeProfile).
node scripts/job-board.mjs render
node scripts/job-board.mjs package-ready <job-id|company> --package "<Company - Role>" --variant "<variant>"
node scripts/job-board.mjs applied <job-id|company> --date YYYY-MM-DD --outcome Submitted
node scripts/backfill-job-identities.mjs --apply

# Inspect the profile-local queue for completed scheduled interviews that still
# need a transcript or postmortem. Scheduled Gmail sync runs this automatically.
node scripts/scan-interview-postmortems.mjs
# Deliberately include earlier events (not part of normal scheduled operation).
node scripts/scan-interview-postmortems.mjs --backfill
# Preview the queue without updating its runtime state.
node scripts/scan-interview-postmortems.mjs --dry-run

# Optional controlled override; the asynchronous LinkedIn assessment default remains 5/day.
LINKEDIN_ASSESS_DAILY_CAP=10 node scripts/assess-jobs.mjs

# Build the senior/general base (source + output resolve to the active profile):
node scripts/build-resume-formats.mjs --source resume.md --export

# Build a tailored package PDF and deliver it into the package folder:
node scripts/build-resume-formats.mjs --source "<package>/resume.md" --out-dir /private/tmp/resume-export \
  --resume-title "<Company Role>" --export --deliver "applications/<Company - Role>" --require-terms "term1,term2"

# Review a profile-bound application-form fill plan. The assisted browser blocks submission.
RESUME_OS_PROFILE=example node scripts/apply-form-assist.mjs --manifest profiles/example/work/application-form-example.json --dry-run
```

To assess a new model or compare models for a pipeline job, follow
`evals/model-comparison.md`. It requires deterministic smoke/protected-fact gates and a separate
human-vetted judgment layer before any model binding changes.

When visual review finds a conspicuous avoidable gap at the bottom of page one, the tailoring
methodology may compare a build with `--skills-first`. It is a conditional layout fallback, not
the default; if adopted, use the flag for both the scored build and final delivery.

To run a different person, set `activeProfile` in `resume-os.config.json` and create `profiles/<id>/`
(see `profiles/example/`).

## Agent memory

This repo carries a git-tracked memory system (agent-memory-kit) about the engine itself, kept
separate from any profile data:

- `memory/semantic.md`: distilled engine knowledge (architecture, extension points, gotchas).
- `DECISIONS.md`: append-only architectural decisions.
- `memory/candidates.md`: staged lessons awaiting promotion.
- Entry points: `CLAUDE.md` (Claude Code) and `AGENTS.md` (Hermes and Codex). Configured in
  `.agent/project.yaml`; regenerate with `python .agent/memory-kit/generate.py all`.
- Hook enforcement is Claude-only (`.claude/settings.json` → `hooks/`). Codex is instruction-driven
  through `AGENTS.md`; do not copy Claude hooks or `$CLAUDE_PROJECT_DIR` commands into `.codex/`.

Memory is about the OS (architecture, extension, maintenance), never candidate/profile content.

## Job email details

`Needs Action` and `Interviewing` rows show details and an email link from the newest dated event. Gmail message IDs open directly; IMAP IDs use a subject search. These private fields remain in profile-local data. Historical imports cannot displace a more recent board update.

## Interview preparation

Use the `interview_prep` route for upcoming interviews or the next round of an active application. `interview-prep.md` owns confirmation checks, bounded source evidence, stage-specific preparation, and responsive, printable HTML briefs. Private interview facts remain in the profile package.

## Resume display title

New exports use the shared single-column Arial presentation with restrained teal accents. `--display-title "<Target role>"` controls the visible title independently of the filename set by `--resume-title`. Base exports use the configured variant title. Narrow and skills-first layouts inherit the styling. Submitted packages remain frozen; validate each new PDF visually and against the two-page limit.
