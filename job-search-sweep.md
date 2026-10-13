# Job Search Sweep

Operational skill for finding jobs posted since the last completed sweep, reconciling exact job
identity, screening new roles, refreshing the active queue, and reporting the next application
order. Consume it through the `job_search_sweep` resolver route, which also loads
`job-screening.md`.

This file owns orchestration only. Do not copy parsing, identity, scoring, lifecycle, or rendering
logic into it.

## Existing owners

| Concern | Source of truth |
|---|---|
| Active profile, work paths, search titles, locations, exclusions | `engine/config.mjs` and the active `profile.json` |
| LinkedIn search and recency filter | `scripts/search-linkedin-jobs.mjs` |
| LinkedIn and employer requisition extraction | `engine/job-identity.mjs` |
| Duplicate stopping and job ingestion | `scripts/process-job.mjs` |
| Screenability and exclusions | `engine/job-screenability.mjs`, `engine/job-exclusions.mjs` |
| Q/I/A/V/PV anchors, lanes, freshness, outreach treatment | `job-screening.md` |
| Lifecycle changes and tracker rendering | `scripts/job-board.mjs` |
| Prospective score freeze | active profile's `work/prospective-screening.md` |
| Successful discovery boundary | `scripts/finalize-linkedin-discovery.mjs` and repository-root `.linkedin-last-checked` |

If an owner already performs a step, call it. Do not reproduce its logic in shell snippets,
another script, this skill, or profile files. If the owner is wrong, fix and test the owner.

## Transaction boundary

Treat a sweep as one recoverable transaction:

1. Read `.linkedin-last-checked` as epoch milliseconds, retain that exact value as
   `expectedBoundary`, and convert it to an ISO timestamp for search. If it is missing, do not infer
   an unbounded history: obtain an explicit initial lower bound and use the literal `missing` as the
   finalizer's expected value.
2. Record `runStartedAt` before searching.
3. Do not change the saved boundary until every result has a terminal reconciliation state.
4. On authentication, browser, network, parsing, or unresolved-identity failure, retain the old
   boundary and report the blocker. A rerun from the same boundary is safe because exact identities
   are idempotent.
5. After successful reconciliation, run
   `scripts/finalize-linkedin-discovery.mjs --expected <expectedBoundary> --run-start <runStartedAt-ISO>`.
   The owner locks the boundary, rejects a concurrent change or regression, and atomically persists
   `runStartedAt` as epoch milliseconds. Jobs posted during the run remain inside the next interval.

## Run the sweep

### 1. Search the saved interval

Run `scripts/search-linkedin-jobs.mjs --since <previous-success-ISO> --json`. Let the script use
the active profile's configured titles, location, and company exclusions.

LinkedIn's recency filter is candidate generation, not proof of posting time. Treat every returned
card as unreconciled until exact identity and the target page's own posting time are checked.

### 2. Reconcile exact identity before judgment

Create one fresh staging directory under the active profile's
`work/runtime/job-search-sweep/<run-id>/`. Pass each candidate URL to
`scripts/process-job.mjs --out <candidate-staging-directory> --no-save` before checking posting
age, comparing company or title, screening fit, or creating a record under `work/inbox/`. A normal
staged success must report `saveAttempted: false`; early duplicate, exclusion, or authentication
results are terminal inspection outcomes and may not carry that field. Staging must not change
LinkedIn save state.

The owner checks identity at the first possible point in this order:

1. LinkedIn job ID before opening the browser.
2. Employer-scoped requisition ID immediately after the apply URL is extracted.
3. Canonical URL.

An exact match stops normal ingestion. Report the canonical record and whether application
evidence already exists. Different requisition IDs remain separate even when employer and title
match. Company/title similarity may prompt inspection but is never a duplicate key.

Do not use `--allow-existing` during an ordinary sweep. It is reserved for an intentional refresh
or the existing signal-assessment path.

### 3. Confirm the interval and employer page

For a staged new identity, confirm the target job's own page-level date or relative time. A promoted
or recommended job dated before the saved boundary is out of window: report it, but do not ingest,
screen, or rank it unless the user explicitly requests backlog recovery. Never use dates from
recommendation cards for the target job. If the visible time is too coarse to determine whether it
falls inside the interval, record the ambiguity and do not claim it as a new in-window job.

For an in-window identity, inspect the exact employer or ATS URL when staging captured one. For an
Easy Apply role without an external URL, use the exact LinkedIn job page as the target record.
Confirm that the requisition is open, the work location is viable, and compensation is copied only
from that target JD or official ATS record. Treat HTTP 200 alone as insufficient because some ATSs
serve closed-job shells with a successful status.

After both checks pass, choose a new, unique directory under the active profile's
`work/inbox/<job-id>/` and run `scripts/process-job.mjs <candidate-url> --out <that-directory>`.
The directory name is a handle, not identity evidence; never replace an existing directory merely
because company and title match. Repeating the fetch is preferable to copying staged files around
the ingestion owner. Inspect the final command result: a duplicate, exclusion, authentication
challenge, or other failure is not a successful ingestion. Confirm that the destination
`metadata.json` exists before screening the role. Remove only the run's explicitly created staging
directory after every candidate is reconciled.

Keep the LinkedIn ID and employer requisition ID in their separate metadata fields.

### 4. Screen only verified new jobs

Apply `job-screening.md` without restating its gates, anchors, formula, or thresholds here. Read the
JD and profile evidence, persist the pass or skip basis, name assumptions, and use
`scripts/job-board.mjs screen` for lifecycle changes.

For every newly scored application candidate, append one frozen row to the active profile's
`work/prospective-screening.md`. Outreach sent after scoring is an intervention and never changes
the frozen A score.

### 5. Refresh the existing application queue

List current `to_apply` records and check each exact application page. Move a confirmed closed or
expired requisition out of the active queue with
`node scripts/job-board.mjs outcome <job-id> --outcome Closed`; do not delete its history and never
hand-edit `jobs-tracker.md`.

Recompute a stale freshness band and rank index according to `job-screening.md` for the current
session. Report the recalculated order without rewriting `lifecycle.priority` or the frozen
prospective tuple; the current board has no safe freshness-only priority update command.

### 6. Report the queue

Render the tracker, then assemble the queue manually because the board displays priority strings
but does not parse or sort them. Group by Focus, Stretch, and Qualified. Within each lane, put
ACT-NOW entries first, then sort ACT-NOW and ordinary entries separately by descending rank index.
Mark proposed post-application outreach exactly as defined in `job-screening.md`. Never send
outreach or submit an application without explicit authorization.

Report:

- searched interval and whether the boundary advanced;
- raw, excluded, out-of-window, exact-duplicate, new, and unresolved counts;
- duplicate basis and prior-application status;
- new screening decisions with explicit pass or skip bases;
- closed queued requisitions and freshness-only changes;
- complete lane-grouped application order;
- data-quality problems separately from fit decisions.

## Completion gate

A sweep is complete only when:

- every returned candidate is excluded, out of window, an exact duplicate, or ingested and
  screened;
- every retained role has an exact official ATS page, or the exact LinkedIn page for Easy Apply,
  and verified open status;
- the reported application order uses current freshness and does not claim that stale priority
  strings in the rendered tracker were updated;
- frozen prospective scores were not rewritten;
- the saved boundary advanced only after no unresolved item remained.

## Scheduled collection and bounded worker

This is a separate operational contract from the interactive, screened sweep above.
Daily `run-linkedin-discovery.mjs` collects paginated cards into the durable pending
queue. Each run starts at page 0 over a fixed recent window (default 48 hours),
keeps undated cards eligible, caps pages, and reports page-cap hits as an
observability signal. Exact-ID dedupe makes repeated overlap safe. Coverage describes
observed LinkedIn search pagination, not all market postings or a stable historical snapshot.
The separate interactive sweep boundary is unchanged.

`run-linkedin-worker.mjs` claims a bounded FIFO batch from the profile-local pending
queue. It invokes `retrieve-queued-job.mjs` and uses the existing enrichment skill only for unresolved extraction. FIFO is neutral
execution order; do not interpret it as job priority. Screening, whether to invest in a
role, and match-assessment requests belong to `job-screening.md` and the human's task.
Do not add relevance scoring or ATS extraction heuristics to the queue/runner.

The enrichment skill receives only leased canonical IDs. Do not widen the batch, run
new searches, redo ingestion, assess matches, modify scheduler state, or send messages.
Repair partial output and preserve uncertainty. Full/partial factual output with valid
metadata and structure is required for completion; blocked content is not success.
Ordinary extraction failure may continue within the batch. A LinkedIn checkpoint,
login barrier persists the manual-review stop. HTTP 429 ends the batch and records a
shared timed cooldown. Do not switch sessions or retry during either hold. The queue retains unfinished work.

Reports show collected, attempted, completed, duplicate/excluded, pending, blocked, and
oldest waiting work. Budgets count job attempts, not browser requests or a promised safe
LinkedIn rate. Review a growing/aging backlog before changing workload budgets; do not
spawn more LinkedIn workers automatically. Completed items live in canonical inbox
metadata/artifacts, not a second history list inside the pending queue.

## Scheduled source-retrieval hierarchy

1. Reuse an employer URL already observed for this exact LinkedIn ID. Do not assign a
   page-level Apply link to every card. Otherwise load the results detail pane for the
   queued ID, using response evidence or verified selected-detail DOM. Never click Apply
   or Save to obtain a URL. Ambiguous identity is a failure, not a guessed association.
2. Persist the verified link before fetching it. Fetch the employer page once with the
   normal HTTP client and extract `JobPosting` JSON-LD before any model call. Exact
   employer plus title, or a previously collected matching requisition, is required for
   automatic acceptance. Multiple matching postings are ambiguous. Keep unknown facts
   unknown; structured extraction does not retrieve application questions or top-applicant
   signals, and must not claim it did.
3. When the HTTP page lacks usable structured data, retain the canonical pending record
   and let the enrichment skill render the exact employer URL in a browser, inspect
   JSON-LD/known DOM fields, and use visible-text interpretation only when necessary.
   Inspect `metadata.retrieval` and its evidence path first. Do not repeat a successful
   stage or refetch LinkedIn when its verified employer URL is already stored.
4. An alternate source search is permitted only with a requisition ID already collected
   from the source. Require the same employer and exact ID. Similar titles are not proof.
   Missing requisitions do not justify approximate search results; retain unresolved work.
5. On employer 429, defer to the next bounded attempt; do not switch clients immediately
   to evade it. On a CAPTCHA/access challenge, stop that job for review. A LinkedIn
   authentication barrier stops the entire LinkedIn workflow for manual review. For
   LinkedIn HTTP 429, run `node scripts/record-linkedin-cooldown.mjs` with the Retry-After
   value as an optional quoted argument, then stop the batch. The next ordinary scheduled
   run may resume after the shared cooldown expires. Do not rotate accounts, proxies,
   or sessions to get around a barrier.
6. Save source evidence and verified artifacts before queue acknowledgement. Successful
   structured extraction bypasses enrichment calls. Skills write the existing full/partial
   enrichment contract only when factual extraction succeeded; blocked content cannot
   complete a job. Persist exact LinkedIn aliases on the canonical record before dropping
   duplicate queue entries. Failed attempts remain pending with cooldown; exhausted work
   remains visibly blocked. The canonical inbox, not a second history queue, records completion.

The harness owns durable stages, accounting and exact structural checks. Skill judgment
owns site adaptation, description completeness, and ambiguous-source interpretation.

Discovery accumulates cards across bounded scrolling before advancing pagination. An
unknown scroll boundary preserves incomplete coverage. All LinkedIn response 429s,
including background results requests, trigger the shared cooldown. The fallback
cooldown is a local conservative policy, not a measurement of a platform heat meter.
