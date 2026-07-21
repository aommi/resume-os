# Resume OS v2

A reusable engine for resume tailoring, job-pipeline tracking, and application packaging.
The reusable engine is profile-agnostic; each person's private data lives under `profiles/<id>/`.

## Repository layout

- **Engine (reusable, shareable):**
  - `resume-os.md`, `tailoring-methodology.md`, `bullet-rubric.md`, `eval-rubric.md`: skill docs (judgment/process).
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

```bash
# Paths resolve within the active profile (resume-os.config.json → activeProfile).
node scripts/job-board.mjs render
node scripts/job-board.mjs package-ready <job-id|company> --package "<Company - Role>" --variant "<variant>"
node scripts/job-board.mjs applied <job-id|company> --date YYYY-MM-DD --outcome Submitted

# Optional controlled override; the asynchronous LinkedIn assessment default remains 5/day.
LINKEDIN_ASSESS_DAILY_CAP=10 node scripts/assess-jobs.mjs

# Build the senior/general base (source + output resolve to the active profile):
node scripts/build-resume-formats.mjs --source resume.md --export

# Build a tailored package PDF and deliver it into the package folder:
node scripts/build-resume-formats.mjs --source "<package>/resume.md" --out-dir /private/tmp/resume-export \
  --resume-title "<Company Role>" --export --deliver "applications/<Company - Role>" --require-terms "term1,term2"
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
