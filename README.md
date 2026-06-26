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
  - `sources/`: exhaustive experience, skills bank, LinkedIn draft.
  - `base-resumes/`: `resume.md`, `resume-pm.md`, … (the living base resumes).
  - `work/`: generated/pipeline state: `inbox/`, `applications/`, `events/`, `resume-formats/`,
    `jobs-tracker.md`, `package-queue.md`.
  - `resume-project-tracker.md`, `LEARNINGS.md`, `review-schedule.md`, `positioning.md`: profile memory.

The active profile is `resume-os.config.json` → `activeProfile`. Tooling resolves every profile path
through `engine/config.mjs`, with the repo root as a fallback (so a profile whose data still sits at root
keeps working). Bare filenames in the skill docs (e.g. `resume.md`, `exhaustive-experience.md`) resolve
within the active profile.

## Start here (agents)

1. `resume-os.md`: stable operating model and file roles (engine).
2. `tailoring-methodology.md`: the tailoring engine: phased process, scoring, export (engine).
3. `profiles/<activeProfile>/resume-project-tracker.md`: current state and locked decisions (profile).
4. `profiles/<activeProfile>/LEARNINGS.md`: recent pitfalls and fixes (profile).
5. `profiles/<activeProfile>/review-schedule.md`: recurring reviews that may be due (profile).

If these conflict, prefer the profile tracker for current state, `resume-os.md` for stable rules,
and `tailoring-methodology.md` for package-building procedure.

## Hard rules

- Do not hand-edit `work/jobs-tracker.md`; it is generated from `work/inbox/<job-id>/metadata.json`.
- Use `node scripts/job-board.mjs` for lifecycle changes.
- Do not update submitted application packages unless explicitly reopened.
- Build application PDFs with `scripts/build-resume-formats.mjs`; do not copy random export artifacts.
- Hermes/scrapers provide facts only. Tailoring agents own base-resume choice, keywords, fit, and judgment.

## Common commands

```bash
# Paths resolve within the active profile (resume-os.config.json → activeProfile).
node scripts/job-board.mjs render
node scripts/job-board.mjs package-ready <job-id|company> --package "<Company - Role>" --variant "<variant>"
node scripts/job-board.mjs applied <job-id|company> --date YYYY-MM-DD --outcome Submitted

# Build the senior/general base (source + output resolve to the active profile):
node scripts/build-resume-formats.mjs --source resume.md --export

# Build a tailored package PDF and deliver it into the package folder:
node scripts/build-resume-formats.mjs --source "<package>/resume.md" --out-dir /private/tmp/resume-export \
  --resume-title "<Company Role>" --export --deliver "applications/<Company - Role>" --require-terms "term1,term2"
```

To run a different person, set `activeProfile` in `resume-os.config.json` and create `profiles/<id>/`
(see `profiles/example/`).
