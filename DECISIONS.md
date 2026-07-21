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
