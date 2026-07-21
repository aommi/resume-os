# Model Change Evals Plan

> Operational use: follow `evals/model-comparison.md`. This file preserves the design rationale,
> phased build plan, and deferred ideas; it is not the runbook for a new comparison.

Purpose: detect when changing the LLM model changes resume-tailoring quality enough that we should not assume the same workflow is still safe.

The first version should not be an eval platform. Start with a tiny smoke test that needs no fixtures, no allowlists, no gold labels, and minimal manual review. Build the heavier suite only after the smoke test proves it catches useful model differences.

## V0 Smoke Test

Build one script: `scripts/smoke-test-model.mjs`.

It should:

- read a few self-contained snippets from existing repo files
- start with saved/pasted model outputs in files, not live API calls
- compare two output folders, for example `evals/smoke/outputs/current-default/` and `evals/smoke/outputs/candidate/`
- print a terminal comparison table

No live API integration, no frozen application fixtures, no `draft-allowlist.mjs`, no JSONL output, no PDF/HTML rendering.

Store smoke-test cases separately from real applications:

```text
evals/smoke/
  cases/
    constraint-mec.md
    grounded-paper.md
    grammar-resume.md
    skills-vena.md
    gap-vena.md
  outputs/
    current-default/
    candidate/
```

`applications/` keeps changing as real applications evolve. Anything reused for model comparison should live under `evals/` so the test input stays stable.

Each `evals/smoke/cases/<name>.md` file should contain the prompt plus the exact input facts used as ground truth. Each model's output for that case should be saved as `evals/smoke/outputs/<model>/<name>.md`. The script pairs cases and outputs by filename.

V0 does not need an LLM judge. The judge is code. If later we add subjective quality scoring, use a fixed third model as judge, not either model being compared.

## V0 Checks And Signals

Track only three objective signals at first:

| Metric | Meaning | Gate |
|---|---|---|
| `constraint_pass` | Exact instruction compliance: bullet count, word count, no first person, no trailing period, preserved metrics | Gate |
| `gap_leakage` | True-gap or context-only terms from an existing `keywords.md` appear as claimed skills or experience | Gate |
| `novel_entities` | Numbers or capitalized entities appear in output but not in the prompt input | Report |

`novel_entities` is a hallucination canary, not a hard gate in V0. It will false-positive on harmless paraphrases like `5%` to `five percent` or `Summit Outfitters` to `Mountain Equipment Company`; the point is to make likely invention visible in a 10-second glance.

The smoke test has five checks, but they map to the three signals:

| Check | Signal |
|---|---|
| Strict Constraint Rewrite | `constraint_pass` |
| Minimal Grammar Edit | `constraint_pass` + protected-fact preservation |
| Skills Block Integrity | `gap_leakage` |
| Gap Leakage | `gap_leakage` |
| Grounded Bullet Rewrite | `novel_entities` report + banned-word check |

Use one shared extractor for numbers and protected entities. Do not write separate token logic for `numbers unchanged`, `metrics preserved`, and `novel_entities`.

Keep the V0 extractor simple: extract numbers/date-like tokens and capitalized multiword spans, then run set comparisons. Do not try to classify every token as a title, employer, school, or tool in V0; typed categories can wait for Phase 1 if needed.

## V0 Cases

Use self-contained cases where the prompt contains the exact source facts the model is allowed to use. That makes the prompt input the temporary ground truth.

| Eval | Source | Check |
|---|---|---|
| Strict Constraint Rewrite | One bullet group from `exhaustive-experience.md` | Exact bullet count, max words, no first person, no trailing periods, numbers unchanged |
| Grounded Bullet Rewrite | One fact-rich bullet group from `exhaustive-experience.md` | Report numbers/proper nouns in output that were absent from input; check banned words |
| Minimal Grammar Edit | One existing resume bullet with small injected grammar issues | Names, numbers, titles, dates, and bullet count unchanged |
| Skills Block Integrity | One JD excerpt + `skills-bank.md` excerpt | Every emitted skill appears in the prompt; true-gap/context-only terms do not appear as skills |
| Gap Leakage | True-gap/context-only rows copied into the case file + generated output | No true-gap terms appear as claimed skills or experience |

Protected-fact checks should cover:

- full name, phone, exact displayed address/location, and email
- LinkedIn, GitHub, portfolio, project, credential, and every other supplied URL
- titles, especially level changes such as `Product Manager` to `Senior Product Manager`
- employers and employer aliases
- dates and date ranges
- numbers and metrics
- tools and technologies
- schools, degrees, and credentials

For live full-resume/package outputs, `scripts/score-resume.mjs` and
`scripts/build-resume-formats.mjs` enforce identity/contact/link invariants against the active
profile through `engine/resume-protected-facts.mjs`. These are hard gates, not novel-entity reports.

In V0, this list is the coverage goal, not a typed extraction requirement. The first implementation can report token-level diffs; a later version can classify the diffs by title, employer, date, metric, tool, or credential if that proves useful.

`skills_integrity` is skills-section-specific. `gap_leakage` is broader: it should catch true-gap terms leaking into any claimed experience or output. Keep both only if they test different surfaces.

Good starting inputs:

- Ledgerline for gap leakage because the package has a real tension: `AI Portfolio` title, senior SaaS/platform JD body, and FP&A/CPM gaps.
- One Summit Outfitters or Tutorly source block from `exhaustive-experience.md` for rewrite and constraint checks.
- One current resume bullet for minimal grammar edit.
- One `skills-bank.md` excerpt plus a JD excerpt for skills integrity.

## V0 Output

Example output:

Output shows per-check detail. These rows roll up into the three signals: `constraint_pass`, `gap_leakage`, and `novel_entities`.

```text
model: current-default        model: candidate
constraint: PASS             constraint: FAIL (wrong bullet count)
protected_facts: PASS        protected_facts: FAIL (title changed)
novel_entities: 2 REPORT     novel_entities: 7 REPORT
grammar_edit: PASS           grammar_edit: PASS
skills_integrity: PASS       skills_integrity: FAIL (unsupported FP&A)
gap_leakage: PASS            gap_leakage: FAIL (corporate performance management)
```

V0 succeeds if:

- the script runs end to end in one command
- the current strong model passes the gated checks
- a weaker candidate model shows meaningful failures, or the test proves these checks are too noisy
- `novel_entities` reports are quick to review and do not create maintenance work

If V0 does not produce useful signal, stop. Do not build fixtures, allowlists, ranking gold, planted hallucination cases, or a runner framework.

## Checks To Reuse

Reuse the existing project rules where cheap:

- banned words from `bullet-rubric.md`
- true-gap and context-only terms from existing `applications/*/keywords.md`
- skills evidence from `skills-bank.md`
- title/date/employer/metric/tool facts from each smoke-test input

Do not start with a broad `scripts/checkers.mjs` refactor. For V0, duplicate or locally define tiny checks if needed. Extract shared checkers only after there are two real consumers.

## Later, If Needed

Only add heavier evals after V0 exposes a specific blind spot.

### Phase 1: Structured Text Suite

Add this when V0 works but prompt-token comparison is too crude:

- `evals/fixtures/`
- fixture schema and case schema
- `scripts/draft-allowlist.mjs`
- source-fact allowlists
- JD tailoring with supported claims only
- house-style section generation
- JSONL outputs and baseline snapshots

Use 3 fixtures and 8-12 total cases. Include one Ledgerline case, but do not make Ledgerline the whole suite.

### Phase 2: Gold-Data Evals

Add these only when mechanical checks pass but model quality still differs in ways V0/Phase 1 cannot see:

- Resume Information Extraction with gold JSON
- Bullet Ranking with gold top IDs and accepted alternates
- Planted Hallucination Detection with deliberately corrupted variants

These require real hand-labeling. Add them one at a time.

### Phase 3: Shared Checker Refactor

The repo already has deterministic ship checks in `scripts/score-resume.mjs`, including banned words, duplicate openers, repeated metrics, term coverage, PDF text parsing, and rendered checks.

Keep PDF/render checks in the ship scorer until a model eval specifically needs the full render pipeline. If the eval runner and ship scorer both need the same text checks, extract shared pure functions into `scripts/checkers.mjs` with an API that supports both full resumes and snippets.

## Deferred Eval Ideas

Keep these ideas, but do not build them first:

1. **JD Tailoring With Supported Claims Only**: useful once true-gap annotations are available in a structured way.
2. **Resume Information Extraction**: useful but requires gold JSON.
3. **Bullet Ranking**: high-signal, but requires human gold labels.
4. **Planted Hallucination Detection**: high-signal, but requires adversarial variants and answer keys.
5. **House Style Section Generation**: useful after basic rewrite and constraint checks prove stable.

## Rollout Order

1. Pick 3-5 self-contained snippets from existing repo files.
2. Save the cases under `evals/smoke/cases/`.
3. Generate outputs manually by running each case prompt through the current default model and a candidate model, then paste the responses under `evals/smoke/outputs/<model>/`.
4. Write `scripts/smoke-test-model.mjs` to compare saved outputs.
5. Inspect whether failures are meaningful or noisy.
6. If useful, add live API calls as a separate step.
7. If it misses important model differences, add the smallest Phase 1 feature that addresses the miss.

## Open Decisions

- Which two models should the first smoke test compare?
- Which 3-5 source snippets should be the initial self-contained cases?
