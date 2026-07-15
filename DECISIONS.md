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
