# Resume OS: Architecture Review + Multi-Tenant Refactor Plan

> Status: **planning document, approved, not yet implemented.** Self-contained build context: either
> executed now or picked up cold by a later agent. All reviewer dispositions (DeepSeek + Codex/GPT + a
> third structural pass) are integrated into the phases below; provenance is in Appendix A and the full
> review transcripts are preserved verbatim in Appendix B. Updated 2026-06-25.

## Context

`resume-os-v2` is a mature, mostly-markdown "operating system" for resume tailoring and job-pipeline
management, built single-tenant around one user (the owner). Goals: (1) honest architecture review for
maintainability/extensibility, (2) align with the **Thin Harness, Fat Skills** ethos, (3) factor personal
data out of reusable logic so other people, different profiles, different job targets, can run it,
eventually as a SaaS with an MCP surface, using **different models for different steps**.

Owner decisions (do not relitigate):
- **Near-term focus = right architecture + reusability with someone else's data + still works after.**
  Distribution and SaaS/MCP are eventual, later phases, not built now.
- Substrate = profile-folder now; **carve** the SaaS/DB seams but do not implement the backend yet.
- Models = model-per-step **configurable** (schema only); define agent boundaries, leave the runtime
  (Claude Code / Codex / SDK) open.
- Runtime neutrality kept **implicit** (avoid runtime-specific assumptions; no formal tool contract yet),
  with one exception adopted from review: the Claude-Code bootstrap is named as an adapter (see Phase 5).

### Scope this round vs. later
- **NOW, in order:** P0a setup → P0b cleanup → P1 config/profile resolution + de-personalize → P2 move
  the owner's data → P3 fake-profile proof → P4 template extraction → P5 resolver split + `models.json`
  (schema only). Profile/config separation goes first; everything else follows once the cut is proven.
- **LATER (seams cut now, built later):** storage adapter (DB-readiness), MCP, SaaS, computer-use
  submission automation. No backend code now.

---

## Part A: Architecture Review

### How it maps to Thin Harness, Fat Skills today (~70% aligned)

| Ethos layer | In this repo | Verdict |
|---|---|---|
| **Fat skills** (markdown judgment) | `resume-os.md`, `tailoring-methodology.md`, `bullet-rubric.md`, `eval-rubric.md` | Strong. Judgment in prose. |
| **Thin harness** (runtime loop) | The agent session (Claude Code today) + `cold-start-prompt.md` bootstrap | Partial, and deliberately runtime-deferred this round. Named here, not built as a layer. |
| **Deterministic app** | `scripts/*.mjs` (job-board, score-resume, build-resume-formats) | Strong. Lookups/renders/checks are code. |
| **Resolver** (route intent → docs) | `cold-start-prompt.md` + README "Start Here" | Weak/implicit, fixed in Phase 5. |
| **Latent vs deterministic split** | `eval-rubric.md` (latent checklist) + `score-resume.mjs` (gates) | Excellent, the standout. |
| **Self-learning loop** | `LEARNINGS.md`, `review-schedule.md`, `evals/smoke/` | Present and real. |

### Strengths (preserve)
- **Judgment in skills, lookups in code.** The hard ethos test is mostly already passed.
- **Source-of-truth → generated view:** `jobs-tracker.md` rendered from `inbox/*/metadata.json`
  (hand-edit banned); `resume-formats/` from `resume*.md`.
- **Deterministic ship-check:** `score-resume.mjs` + `eval-rubric.md` keyword decision table, a clean
  latent/deterministic boundary.
- **Disciplined memory & boundaries:** locked decisions, artifact-boundary rule (bases vs. packages don't
  auto-propagate), immutable event files.
- **Model-swap thinking already exists** (`evals/smoke/outputs/{deepseek,sonnet}`, `smoke-test-model.mjs`).

### Weaknesses (block reuse / SaaS)
1. **Personal data leaks into reusable logic.** `resume-os.md` (6×) and `tailoring-methodology.md` (6×)
   hardcode the candidate name; `build-resume-formats.mjs:18` bakes the name into the PDF filename;
   `job-board.mjs:13` hardcodes `America/Vancouver`.
2. **No profile abstraction.** Engine docs, scripts, and one user's working data all live at the repo root.
3. **Template embedded in the harness.** `build-resume-formats.mjs` inlines CSS + HTML (~303–395).
4. **No storage abstraction.** Scripts read/write files by hardcoded relative path.
5. **Resolver is a monolith.** `cold-start-prompt.md` loads ~4 large docs every session
   (`resume-os.md` ≈24KB, `tailoring-methodology.md` ≈31KB).
6. **No model-per-step config.** One agent, one model; cheap and expensive steps can't diverge.
7. **Two products in one tree.** Reusable resume engine vs. personal job-application automation
   (scraping, Gmail monitor, Workday autofill) are interleaved.
8. **Organic folder creep (audited 2026-06-25).** Root = 40 items, 27 loose `.md`, flat. Symptoms: dated
   `package-queue*.md` (×3); naming collisions (`resume-os.md`/`resume-project-tracker.md` match the
   `resume*.md` glob); debug one-offs in `scripts/` (`_debug-*.mjs`, `_*.py`); cruft (`.DS_Store`,
   `.linkedin-last-checked`, `Integration Vision Deck.html`, `node_modules` 17M, `Linkedin Posts/`);
   working state (`inbox/` 153 dirs, `applications/` 52) beside engine docs.

### Current → target reorg map
| Current (root) | Target |
|---|---|
| `resume-os.md`, `tailoring-methodology.md`, `bullet-rubric.md`, `eval-rubric.md` | `engine/skills/` (de-personalized) |
| `cold-start-prompt.md` | `adapters/claude-code-bootstrap.md` (thin pointer to `engine/resolver.md`) |
| `README.md`, `model-change-evals-plan.md`, `evals/` | `engine/` (docs + eval harness) |
| `scripts/*.mjs` (real tools) | `engine/tooling/` |
| `scripts/_debug-*.mjs`, `scripts/_*.py` (one-offs) | **delete** (git history recovers) |
| `exhaustive-experience.md`, `skills-bank.md`, `linkedin-profile-draft.md` | `profiles/amirali/sources/` |
| `application-profile.md` | **split**: reusable ATS question keys/field meanings → `engine/schemas/profile.schema.json`; answers/contact/friction → `profiles/amirali/profile.json` |
| `resume.md`, `resume-pm.md`, `resume-po.md`, `resume-ai-workflow.md`, `resume-commerce*.md` | `profiles/amirali/base-resumes/` |
| `inbox/`, `applications/`, `events/`, `resume-formats/`, `jobs-tracker.md` | `profiles/amirali/work/` (directory move; package contents unchanged) |
| `resume-project-tracker.md`, `LEARNINGS.md`, `review-schedule.md` | `profiles/amirali/` (per-profile memory) |
| `package-queue*.md` (3 dated) | collapse to one `package-queue.md` at root (P0b), then move to `profiles/amirali/work/` (P2) |
| `application-questions-plan.md`, `tailoring-vnext-plan.md`, `model-change-evals-vena-dry-run.md`, this doc | `os-planning/` |
| `.DS_Store`, `node_modules/`, `.linkedin-last-checked` | `.gitignore` |
| `Integration Vision Deck.html`, `Linkedin Posts/` | `archive/` (personal content; archive, not delete) |

---

## Part B: Target Architecture (4 layers + 2 seams)

```
resume-os.config.json   THIN root config (machine/env): activeProfile, browser path (auto-detect
                        fallback), timezone fallback, default variant-title map, model defaults.
                        No candidate identity here.

adapters/               Runtime-specific entry points (thin; runtime neutrality lives here)
  claude-code-bootstrap.md   Claude-Code session contract → calls engine/resolver.md
                             (other runtimes get their own adapter later; not built this round)

engine/      Fat skills + thin tooling, profile-agnostic, the reusable product
  skills/      resume-os.md, tailoring-methodology.md, bullet-rubric.md, eval-rubric.md (de-personalized)
  resolver.md  routing table: task type -> which skill doc(s) to load; INCLUDES a default/fallback route
  schemas/     profile.schema.json  (keystone data contract: field meanings + standard ATS question keys)
  tooling/     job-board.mjs, score-resume.mjs, build-resume-formats.mjs, import-events.mjs ...
  templates/   resume.html.tmpl + theme.css  (extracted from build-resume-formats.mjs in P4)
  store.mjs    storage interface (SEAM #1), file adapter LATER, DB adapter later still
  models.json  model-per-step config (SEAM #2), schema/IDs only

profiles/<profileId>/   Per-tenant data, everything user-specific
  profile.json          IDENTITY + answers: name/fullName, contact, ATS answers, filename pattern,
                        variant->title overrides, base-routing rules, positioning frame, job-search signals
                        (validated against engine/schemas/profile.schema.json)
  sources/              exhaustive-experience.md, skills-bank.md
  base-resumes/         resume.md, resume-pm.md, resume-po.md, resume-ai-workflow.md, resume-commerce*.md
  work/                 inbox/, applications/, events/, resume-formats/, jobs-tracker.md, package-queue.md

archive/                Out-of-engine, non-profile content (Integration Vision Deck, Linkedin Posts)
```

**Harness note (thin-harness, intentionally deferred):** the runtime/orchestration loop is the agent
session itself (Claude Code today). It is **not** a built layer this round, runtime choice stays open.
No `harness/` placeholder folder; the boundary is documented here, not scaffolded.

**Config split:** root `resume-os.config.json` = machine/env (tiny); per-person identity = `profile.json`,
validated by `engine/schemas/profile.schema.json`. Reusable structure (field meanings + standard ATS
question keys) lives in the schema; only answers live in the profile.

The agent **pipeline**, discovery through submission (each step = a skill call with a configurable model):

| # | Step | Latent/Deterministic | Model | Source / agent |
|---|---|---|---|---|
| 0 | **discover/ingest** (Hermes + Gmail monitor) | deterministic, "facts only" (no match-judgment here) | none | `search-linkedin-jobs.mjs`, `process-job.mjs`, `fetch-linkedin-job.mjs`, `enrich-job.mjs` → `inbox/<id>/metadata.json` |
| 1 | **route** (base + archetype) | **mixed**, deterministic base-precedence + latent JD/archetype read | cheap | `tailoring-methodology.md` 0.2–0.3 |
| 2 | **tailor** | latent (heavy) | strong | tailoring Phase 1 + `bullet-rubric.md` |
| 3 | **score/judge** | mixed, deterministic via `score-resume.mjs` + mid model for latent checklist | mid | `eval-rubric.md` Phase 2 |
| 4 | **cover letter** | latent | mid | `resume-os.md` Cover Letter skill |
| 5 | **build/deliver** | deterministic | none | `build-resume-formats.mjs` Phase 3 |
| 6 | **submit** (computer-use autofill/apply) | latent + tool-use | configurable | *seam only*, inputs: `profile.json` ATS answers + delivered PDF |

`models.json` commits the *boundaries* and model IDs; the *runtime* stays a swap. Skills stay plain
markdown and tools stay CLIs so any agent (Hermes/Codex/Claude Code/Cowork) can drive the engine.

**Skill editability:** each skill is a standalone markdown file in `engine/skills/`, de-personalized,
edited in isolation; the resolver decides when each loads.

---

## Part C: Execution Plan (phased)

### Migration discipline (every phase)
- **Dual-path, no-downtime:** scripts read config with **today's hardcoded values as defaults** so existing
  commands keep working *before* any files move. Relocate files only after dual-path resolves.
- **No historical rewrites (contents, not location):** existing packages under `applications/` are frozen
  snapshots, their *contents* are never edited. Moving the directory (P2) is a path change only.
- Each phase ships green (see Verification) before the next starts. Sequencing: profile/config separation
  is the high-risk boundary, so it goes first and alone; template/resolver/models follow once proven.

### Phase 0a: Git init + private-data boundary + snapshot (no destructive changes)
- **Write `os-planning/resume-os-architecture-review.md`** (this doc) so others can review in-repo.
- `git init`; **baseline commit** of the current tree first (every later step is a reviewable, reversible diff).
- `.gitignore`: ignore `node_modules/`, `.DS_Store`, `.linkedin-last-checked`/runtime state, and
  `profiles/*` **with a negation** `!profiles/example/` so the demo profile is trackable (a bare
  `!profiles/example/` under an ignored `profiles/` does NOT work, must ignore `profiles/*` then negate).
  Acceptance: `git add profiles/example/` actually stages.
- **Capture the pre-change snapshot** (build every base + variant via `build-resume-formats.mjs --export`;
  run a `score-resume.mjs` scorecard on a known package), the parity baseline for all later phases.

### Phase 0b: Cruft cleanup (separate reviewable commit on top of the baseline)
- Collapse the 3 dated `package-queue*.md` into one `package-queue.md` **at root** (moves into the profile in P2).
- **Delete** `scripts/_debug-*.mjs` and `scripts/_*.py` (git history recovers if ever needed).
- Move `Integration Vision Deck.html` and `Linkedin Posts/` into `archive/`.

### Phase 1: Config/profile resolution + de-personalize (preserve the owner's workflow)
Goal: engine docs + scripts carry **zero** person/machine-specific constants; everything reads through
config with today's values as defaults (no files moved yet, nothing breaks).
- Add root `resume-os.config.json` (activeProfile + machine defaults: browser path, timezone fallback,
  default variant→title map, model defaults). CLI gains optional `--config`/`--profile`; default config
  keeps every existing command valid for the owner.
- **Draft `engine/schemas/profile.schema.json` FIRST** (the keystone contract): field meanings + the
  standard ATS question keys (the reusable structure formerly tangled in `application-profile.md`).
  De-personalization references it.
- De-personalize `resume-os.md` and `tailoring-methodology.md`: replace the literal candidate name and
  filename examples with placeholders (`{{profile.fullName}} - <Company Role> - Resume.pdf`); move
  the candidate-specific "How ... Uses AI As A PM" + narrative-spine specifics into the profile (positioning frame). Engine
  docs name the owner only as example material under `profiles/amirali/`.
- Make scripts config-aware (paths/identity injected, logic stays deterministic): `build-resume-formats.mjs`
  (name :18), `job-board.mjs` (timezone :13), `import-events.mjs`, `build-package-queue.mjs`,
  `enrich-job.mjs`, `score-resume.mjs`, `process-job.mjs`, `fetch-linkedin-job.mjs`.
- **Browser path** (`build-resume-formats.mjs:592`, `process-job.mjs:40`, `score-resume.mjs`) → from config
  with **auto-detect fallback**; don't assume macOS `/Applications/Google Chrome`.

### Phase 2: Move the owner's data into `profiles/amirali/` (compatibility-first)
- After P1's dual-path is green, relocate his data: `sources/`, `base-resumes/`, `work/` (incl. the collapsed
  `package-queue.md`), and per-profile memory (`resume-project-tracker.md`, `LEARNINGS.md`,
  `review-schedule.md`). Split `application-profile.md`, answers/contact/friction → `profile.json`
  (validated by the schema). Default config sets `activeProfile: amirali`.
- **`applications/` is a directory move only**, package contents stay frozen/unedited.
- **Deferred (do NOT do during the move):** auditing `LEARNINGS.md`/`review-schedule.md` for engine-level
  vs profile-level content. Revisit after Phase 3; note it, don't act on it mid-cut.

### Phase 3: Fake second-profile proof (multi-tenant acceptance test)
- Add `profiles/example/` (fictional candidate + one minimal base). **Deterministic path first:** build the
  fake base → score it → render a PDF named for the fake person → render the board from a fake inbox, with
  no the owner file read and **no "the owner" string in engine output**.
- Only after that passes, add one agent/manual **tailoring smoke** (route→tailor) as a separate check.

### Phase 4: Extract the template (data, not code)
- Pull inlined CSS/HTML out of `build-resume-formats.mjs` into `engine/templates/resume.html.tmpl` +
  `theme.css`. Script becomes parse markdown → fill template → render. Verify against the P0a snapshot
  using the parity bar (not byte parity).

### Phase 5: Resolver split + models.json (schema only) + cold-start retirement
- Write `engine/resolver.md` as an explicit routing table ("task = tailor → load tailoring-methodology +
  bullet-rubric; task = pipeline status → load none, run job-board"). **Include a default/fallback route:**
  ambiguous/unknown intent → load `resume-os.md` + `resume-project-tracker.md` (degrades to today's
  cold-start behavior, so the sparse resolver is never worse than the monolith).
- **Retire the cold-start prompt:** `cold-start-prompt.md` → `adapters/claude-code-bootstrap.md`, a thin
  Claude-Code entry point that delegates to `engine/resolver.md` (single neutral routing core + runtime
  adapter). Other runtimes get their own adapter later; not built now.
- Add `engine/models.json` mapping steps (`route`, `tailor`, `score`, `cover_letter`, `review`) to model
  ids + defaults. **Schema/IDs and boundaries only**, no bind to Claude Code / Codex / SDK / MCP.

---
## LATER PHASES (seams cut above; do NOT build this round)

### Storage interface (SEAM #1, mechanical DB-readiness)
- Once scripts are profile-aware, extracting `engine/store.mjs` (`getProfile`, `listJobs/getJob/saveJob`,
  `listPackages/savePackage`, `appendEvent`, `renderBoard`) is mechanical. File adapter first; Postgres/S3
  later satisfies the same interface with no script changes (`metadata.json` → DB row is 1:1). **Do not**
  route all scripts through `store.mjs` in the first round, explicit path/profile config comes first.

### Submission agent: step 6
- Define `submit` as a pluggable step with a clear input contract (`profile.json` ATS-answer block +
  delivered upload PDF) and existing guardrails (human confirms T&C and final Submit; never touch
  passwords). A Cowork/computer-use agent can later own this step via the same contract, no engine change.

### MCP + SaaS surface
- Wrap `engine/tooling/*` + skills as an MCP server: deterministic tools (`score_resume`, `build_resume`,
  `job_board`) for power users; skills as MCP prompts. DB adapter + profile schema are the remaining pieces
  for hosted multi-tenant.

---

## Critical files
- New: `resume-os.config.json`, `engine/schemas/profile.schema.json`, `engine/resolver.md`,
  `adapters/claude-code-bootstrap.md`, `engine/templates/resume.html.tmpl` + `theme.css` (P4),
  `engine/models.json` (P5), `.gitignore`, `profiles/example/`.
- De-personalize (P1): `resume-os.md`, `tailoring-methodology.md`, `application-profile.md` (split),
  `build-resume-formats.mjs:18`, `job-board.mjs:13`, browser path at `build-resume-formats.mjs:592` /
  `process-job.mjs:40`.
- Config-aware scripts (P1): `job-board.mjs`, `score-resume.mjs`, `import-events.mjs`,
  `build-package-queue.mjs`, `enrich-job.mjs`, `process-job.mjs`, `fetch-linkedin-job.mjs`.
- Template extract (P4): `build-resume-formats.mjs` (~303–395) → `engine/templates/`.
- Reuse, don't rebuild: `score-resume.mjs` + `eval-rubric.md` and the `metadata.json`-as-source-of-truth
  pattern are already SaaS-shaped, keep as-is.

## Verification

**Parity bar (visual/text, NOT byte parity).** Chrome PDFs differ byte-for-byte on metadata/timestamps,
so a refactor "passes" vs. the P0a snapshot when: same output filenames; same page count; same extracted
text (select-all → copy → diff); screenshot/PNG visually equivalent within tolerance; identical
`score-resume.mjs` scorecard.

- **P0a:** baseline commit exists; `git add profiles/example/` stages (gitignore negation works); snapshot captured.
- **P0b:** cleanup is its own commit; root still builds (parity bar) after collapse/delete/archive.
- **P1, no-regression:** every existing command runs through default config; rebuild the owner's bases and
  meet the parity bar; daily flow (bootstrap → tailoring → `job-board.mjs`) unchanged.
- **P1, config-resolution checks:** missing config fails clearly; missing profile path fails clearly;
  output filename uses configured name; tracker renders from configured inbox path; event import uses
  configured event paths; browser-path override works with auto-detect fallback.
- **P2, move:** after relocation + `application-profile` split, re-run the parity bar; nothing changes;
  `applications/` contents byte-identical (move only).
- **P3, multi-tenant proof (deterministic first):** `profiles/example/` builds + scores + renders + boards
  with no "the owner" string and no the owner file read; then a separate route→tailor smoke.
- **P4, template:** rebuild against the P0a snapshot; meet the parity bar.
- **P5, resolver test (deterministic):** given task type X, assert the resolver returns the expected doc
  list, including the fallback route for ambiguous intent; zero model cost.
- **P5, model-config proof:** flip a step's model in `engine/models.json`; confirm the step picks it up
  (smoke via `smoke-test-model.mjs`). No runtime binding asserted.

---

## Appendix A: Review dispositions (2026-06-25)

Reviewed by DeepSeek (deepseek-v4-pro), Codex/GPT (two passes), and a third structural pass. All approved
the direction. Adopted and integrated into the phases above:
- **DeepSeek:** gitignore negation (#4, corrected to `profiles/*` + `!profiles/example/`); cold-start
  retirement as pointer not `.legacy` (#1); deterministic resolver test (#8); application-profile split,
  trimmed to the schema (#2); `Linkedin Posts/`→archive (#3); delete debug scripts (#5); package-queue
  collapse-at-root-then-move (#6). **Deferred:** LEARNINGS/review-schedule content audit (#7).
- **Codex/GPT:** P0a/P0b split with cleanup as a separate diff; move-vs-rewrite wording (contents frozen,
  directory moves); `profile.schema.json` as the engine home for reusable structure; typo fix; the 5
  acceptance criteria (carried into Verification).
- **Third structural pass:** adopted #5 (cold-start as `adapters/` runtime adapter) and #1 (resolver
  fallback route). Rejected as already-handled/misread/premature: #2 (latent/deterministic, ingest is
  "facts only" by design; route is labeled mixed), #3 (schema already in P1), #4 (confidence flags /
  graceful latent fallback = premature SaaS concern), #6 (artifact-boundary rule already exists,
  carries over per-profile), #7 (harness intentionally deferred; documented, not scaffolded).

---

## Appendix B: Full review transcripts (verbatim, for provenance)

### DeepSeek (deepseek-v4-pro): 2026-06-25 (review only, no plan changes)

**Overall assessment.** This is a strong plan. The diagnosis is honest (the 40-item root listing in
weakness #8 is the confessional it needs to be), the target architecture is clean, and the phasing is
disciplined, config/profile separation first and alone is the right call. The verification bar
(visual/text parity, not byte parity, with explicit pre-change snapshot capture) shows real deployment
experience. The plan earns its "not yet implemented" status marker, it doesn't overprescribe. It names
what to build now, what seams to cut for later, and what NOT to build this round. That restraint is rare
and correct.

**What's right.**
- *Phase ordering.* Config/profile resolution goes first, alone, before any file moves. This prevents the
  "move everything then discover scripts are broken" failure mode. Dual-path with today's values as
  defaults is the correct migration pattern.
- *Two products named.* Weakness #7 (resume engine vs. personal job automation) is the most important
  distinction in the document. Naming it now prevents the refactor from accidentally entangling them again.
- *Models.json as schema-only.* Committing boundaries and step names without binding to a runtime is
  exactly right for the current scope. The runtime decision is downstream and shouldn't block
  architectural correctness.
- *Deterministic-first multi-tenant proof.* Phase 3 validates the score/render pipeline with fake data
  before testing the latent (agent-driven) tailoring path. This isolates failures.
- *Storage seam is mechanical, not architectural.* Calling out that `metadata.json` → DB row is a 1:1
  mapping means the seam is already cut. The `store.mjs` extraction is deferred correctly, it's plumbing.

**Gaps and questions.**
1. *Cold-start prompt fate.* `cold-start-prompt.md` loads all 4 skill docs every session. Phase 5
   introduces `resolver.md` but doesn't say what happens to the cold-start prompt. If it stays as a
   parallel entry point, sessions bypass the resolver. Recommendation: Phase 5 should deprecate it (rename
   to `cold-start-prompt.legacy.md`) and document the resolver as the single entry point.
2. *`application-profile.md` is personal data, not a schema.* The reorg map puts it in
   `profiles/amirali/sources/`, but Phase 1 lists it as a file to de-personalize and seed `profile.json`
   from. The ATS-answer block and standard-question table are probably a reusable schema. Recommendation:
   split it, the question schema lives in `engine/schemas/ats-questions.json`, answers go to the profile.
3. *`Linkedin Posts/` destination.* The reorg says "out of the engine path" but doesn't name where.
   Recommendation: decide explicitly, `archive/Linkedin Posts/` or delete.
4. *Gitignore + example profile tracking.* Git won't track files inside an ignored directory without a
   negating rule. Recommendation: add `!profiles/example/` and test `git add profiles/example/` before
   Phase 0 is green.
5. *Scratch vs. delete for debug scripts.* Deleting is cleaner; scratch invites cruft re-accumulation.
   Recommendation: delete in Phase 0; `git checkout` from baseline if ever needed.
6. *Dated package-queue collapse timing.* The target dir doesn't exist in Phase 0. Recommendation: collapse
   at root during Phase 0, then move in Phase 2.
7. *`LEARNINGS.md` + `review-schedule.md` might have engine content.* If they contain general methodology
   observations, those belong in the engine. Recommendation: audit both during Phase 1.
8. *No resolver test.* The resolver needs its own deterministic table-lookup correctness check. Given task
   type X, assert the output doc list matches expectation. Zero-model-cost check.

**Verdict.** The plan passes review. The gaps are all addressable within the existing phase structure , 
none require a phase reshuffle or scope change. Execute Phase 0 and 1 first; iterate the unanswered
questions during Phase 1's config resolution work, not as a separate planning pass.

,  deepseek-v4-pro (DeepSeek), 2026-06-25

### Codex / OpenAI GPT-5: 2026-06-25 (pass 1)

I reviewed this architecture plan against the current `resume-os-v2` repo shape and agree with the
direction. The strongest parts: the `engine/` vs `profiles/<id>/` split correctly separates reusable
process from candidate-specific memory; the thin root config plus per-profile `profile.json` is the right
compromise between local reuse now and SaaS-readiness later; the sequencing is sound (config/profile
resolution before moving files, fake-profile proof before deeper abstractions, template extraction after
profile stability); the plan preserves the repo's best existing architecture (markdown skills for
judgment, deterministic scripts for rendering/scoring/pipeline state, generated views from
source-of-truth files); deferring storage adapters, MCP, SaaS, and computer-use submission automation is
the right scope control.

My main implementation caution is Phase 0 cleanup: initialize git and create a baseline commit before
moving, deleting, or quarantining any root files. Treat cleanup as a reviewable execution diff, not part
of the planning artifact itself. That keeps rollback simple and protects the current working pipeline.

Acceptance criteria I would hold the implementation to: existing the owner commands continue to work through
default config before and after the profile move; PDF verification uses text/page/visual parity, not byte
parity; a fake second profile can build, score, and render without reading the owner files; reusable engine
docs contain no private candidate assumptions except examples explicitly scoped under `profiles/amirali/`;
model-per-step config defines boundaries only and should not prematurely bind the system to Claude Code,
Codex, SDK orchestration, or MCP.

Overall: approved as an executable refactor plan. It is appropriately conservative for Phase 1 while still
carving the right seams for later SaaS, MCP, and multi-model orchestration.

### Codex / OpenAI GPT-5: 2026-06-25 (pass 2, post-update)

Verdict: the plan is materially stronger now and is executable, but a few implementation ambiguities
should be resolved before Phase 0/1 starts.
1. Phase 0 mixes baseline setup with cleanup, split into P0a (git init, .gitignore, baseline commit,
   snapshot verification) and P0b (cleanup as a separate reviewable diff).
2. "No historical rewrites" vs. "move applications into profile" needs wording clarity, state explicitly
   that it means moving the directory without changing package contents.
3. Gitignore rules need care, ignoring `profiles/` while tracking `profiles/example/` requires negation
   rules; agree it should be part of Phase 0 acceptance.
4. `application-profile.md` is both schema seed and personal data, extract reusable schema/field meanings
   into engine/schemas or docs, and move the owner's answers/contact/friction notes into profile.json.
5. Cold-start prompt needs a retirement path, it should become a thin pointer to the resolver or be
   marked legacy.
6. Typo in Verification ("picks it pick it up").

Sign-off: approved as an execution plan after those clarifications. The remaining issues are not
architectural blockers; they are implementation hygiene items that should be locked before Phase 0 starts.

### Third structural pass: 2026-06-25 (7 "structural" concerns; 2 adopted, 5 rejected)

Raised: (1) resolver needs a fallback route for ambiguous intent; (2) latent/deterministic
misclassification of Step 0 (discover) and Step 1 (route); (3) `profile.json` has no schema; (4) no error
contracts (structured exit codes, confidence flags, graceful fallback); (5) cold-start prompt betrays the
runtime-neutrality claim, rename to `adapters/claude-code-bootstrap.md`; (6) artifact boundaries
undefined in multi-tenant; (7) thin harness invisible in the architecture diagram, add a `harness/`
placeholder.

Disposition (maintainer): **Adopted** #5 (cold-start → `adapters/claude-code-bootstrap.md`) and #1
(resolver default/fallback route). **Rejected** the rest as already-handled, misread, or premature:
#2 (ingest is "facts only" by design and route is now labeled mixed), #3 (schema already drafted in P1),
#4 (confidence flags / graceful latent fallback are premature SaaS concerns; config/profile errors are
already in Verification), #6 (artifact-boundary rule already exists in `resume-os.md` and carries over
per-profile), #7 (the harness is intentionally runtime-deferred and named in Part A; an empty `harness/`
placeholder is YAGNI). None of the seven changed the architecture.
