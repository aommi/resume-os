# Claude Code: session bootstrap (runtime adapter)

> Runtime-specific entry point. The neutral routing core is `engine/resolver.md` + `engine/resolver.json`;
> this adapter is just how a Claude Code session enters it. Other runtimes get their own adapter.

You are continuing the Resume OS project. The active profile is `resume-os.config.json` → `activeProfile`
(currently `amirali`). Profile files live under `profiles/<activeProfile>/`.

## On boot

1. **Always load** the active profile's `resume-project-tracker.md` (current state, locked decisions).
2. **Route by task** using `engine/resolver.md`, load only the docs that task needs, not everything:
   - tailoring a job → `tailor` route (resume-os.md, tailoring-methodology.md, bullet-rubric.md, eval-rubric.md)
   - ship check → `score`; cover letter → `cover_letter`; base-resume edits → `resume_maintenance`
   - pipeline status → `pipeline_status` (just run the job board); discovery → `discover` (scrapers)
   - unsure → the default route loads `resume-os.md` + `tailoring-methodology.md`.
3. Also read `profiles/<activeProfile>/LEARNINGS.md` and check `profiles/<activeProfile>/review-schedule.md`;
   if today ≥ a row's "Next due", surface that review before other work.

## Tailoring a specific job

Follow `tailoring-methodology.md` exactly: Phase 0 (context + profile + strategy + keywords) → Phase 1
(tailor) → Phase 2 (ship check via `eval-rubric.md` + `node scripts/score-resume.mjs`) → Phase 3
(export/deliver via `node scripts/build-resume-formats.mjs --deliver`) → Phase 4 (package + outcome log).
Present the final scorecard and tailored resume together. Do not skip the ship check.

## Pipeline

`profiles/<activeProfile>/work/jobs-tracker.md` is generated from `work/inbox/<job-id>/metadata.json`;
do not hand-edit it. Use `node scripts/job-board.mjs` for lifecycle changes (`package-ready`, `applied`,
`skip`, `outcome`, `render`). All script paths resolve within the active profile via `engine/config.mjs`.

After reading, confirm current state and pick up the tracker's next open item unless told otherwise.
