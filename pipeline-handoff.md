# Incremental enrichment → owner review

This is an opt-in execution contract, not application authorization. An enriched job
is factual source material, **not** a fit decision, reviewed package, attempted
application, or receipt-confirmed application. The tracked form-assist workflow
remains non-submit. A foreground guarded owner adapter is available at `scripts/application-owner.mjs`;
no application operator, provider or model is selected by default.

## Judgment owner

The configured owner reads `job-screening.md`, current profile policy and source
evidence first. Apply the existing viability/exclusion/referral, work/location and
source-backed freshness rules; do not infer fit or posting date from enrichment.
For an eligible job, use `tailoring-methodology.md`, `bullet-rubric.md` and
`eval-rubric.md` for truthful evidence selection, adaptation and package review.
A missing fact, unresolved duplicate/attempt, or referral hold is a job-local hold,
not a reason to stop unrelated eligible jobs. Do not change policy, clear stop
files, restore revoked permission, reset retries or expand a finite authorized
scope to consume a new ID. An ongoing scope must be explicitly configured by the
owner; the handoff is never authority to add IDs to submission allowlists.

The default request's `mode: review-only` prohibits submission, even if an independently
configured application policy permits it. Keep existing reviewed-package hashes,
final policy rechecks, submission journal/uncertain holds and receipt validation
at the existing application boundary; do not bypass or replace them here. This
contract cannot run a legacy fire-and-forget application launcher unchanged.

## Configure the existing owner

In the active profile's `profile.json`, add only when a compatible owner exists:

```json
{
  "pipelineHandoff": {
    "enabled": false,
    "contractVersion": 1,
    "command": ["node", "path/to/your-existing-owner-adapter.mjs"],
    "timeoutMs": 900000
  }
}
```

This argv is executed without a shell from the repository directory. Enable only
for an owner that implements this protocol. `application-policy.json` in the same
profile must independently contain `enabled: true` and must not have `paused: true`.
`autoSubmit` is neither enabled nor required by this review-only path. Missing or
invalid policy/config fails closed; nothing automatically restores permission.
`work/pipeline-stop.json`, `work/linkedin-stop.json` or `work/application-stop.json` prevents dispatch. The wrapper
rechecks gates immediately before child execution, after acquiring browser ownership.
The supervisor polls cancellation/policy while the child runs, terminates its
process group on revocation (with a bounded kill fallback), and records an uncertain
result rather than retry permission. The owner must also check cancellation/policy
at meaningful work boundaries; polling does not replace any final submit guard.

The owner reads one JSON request on stdin, containing `version`, unique `runId`,
`jobIds` (canonical inbox directory IDs), `work`, `policyPath`, `stage: enriched`
and `mode: review-only`. It stays in the foreground until that exact work is
consumed and finishes with **only** one JSON object on stdout:

```json
{
  "runId": "the-exact-request-run-id",
  "acceptedJobIds": ["the-exact-canonical-id"],
  "outcome": "prepared"
}
```

All requested IDs must be explicitly accepted; use `held` or `uncertain` instead
of `prepared` where appropriate. Per-ID review details may be included in the
result. Logs belong on stderr or in profile work, not mixed with the JSON result.
Detaching a child, returning a PID, an old run's checkpoint, an empty success exit,
partial acknowledgments, or `applied` is not completion. Outcomes and exact accepted
IDs are saved; review-only results never write application lifecycle or count receipts.

## Explicit guarded integration (optional)

To use the bundled adapter, set `pipelineHandoff.command` to
`["node", "scripts/application-owner.mjs"]`. Add a separate `applicationOwner`
object to the same profile: `command` is the foreground preparation argv,
`timeoutMs` its bound, and `execute` defaults to false. For example a locally
reviewed terminal Codex argv adapter can read the supplied stdin prompt, perform
markdown-directed preparation and write the exact result file. See
`application-automation.md` for the result/manifest/review contract. Do not use a
legacy detached launcher unchanged.

Actual execution requires **all** of: `pipelineHandoff.mode: "policy-guarded"`,
`applicationOwner.execute: true`, enabled/unpaused current application policy with
`autoSubmit: true`, matching `profileId` and exact job ID in `jobIds`. Policy version
is 1; optional `expiresAt`, `maxPostingAgeDays`, `postingAgeTimezone`,
`prepareOnlyCompanies`, `maxPerRun`, and `maxSubmissionsPerDay` further restrict it.
Absent any execution opt-in, a valid package is prepared/reviewed only. Missing,
expired, stopped or out-of-scope policy cannot grant permission. The adapter never
widens scope or authorizes new jobs because enrichment finished.

Only guarded requests may acknowledge `outcome: submitted`; per-ID submitted results
must match durable journal receipts before they contribute to
`newReceiptConfirmedApplications`. The worker aggregates only newly consumed runs,
not historical totals. The dispatcher itself never writes applied lifecycle; the
submission boundary does so only after a receipt. Mixed uncertain runs count only
matching new per-ID journal receipts and retain all evidence for reconciliation,
never replay.

## Durability, incremental scheduling and recovery

`run-linkedin-worker.mjs` writes an enriched event **before** removing completed
queue work; reconciliation repairs the crash between artifact writes and queue
acknowledgment. Events deduplicate by existing employer-scoped exact requisition
identity, otherwise exact LinkedIn/canonical identity, never title similarity.
An advanced canonical lifecycle on any known alias holds the exact-job event.

With a configured owner the normal bounded worker settles/enriches one leased job
and dispatches its event before taking the next job, without waiting for the whole
backlog. Unrelated failures stay in the existing bounded retry queue. Without
opt-in, legacy batched enrichment is preserved and events remain pending.
Every ordinary worker run, including an idle restart, drains pending events.
`node scripts/dispatch-pipeline-handoff.mjs` is a manual retry of that same drain,
not a new scheduler or mailbox loop. No schedules are installed or modified.

Events and run-specific request/stdout/stderr/results are under
`work/runtime/pipeline-handoff/`. A process lock serializes state and consumption
across schedulers. Before launch an event is durably `running`; a crash, owner
failure, timeout, invalid acknowledgment or ambiguous result becomes `uncertain`
and is **not automatically relaunched**. Inspect that exact run and existing
application evidence before explicit operator reconciliation. A browser-busy or
revoked pre-launch refusal leaves it pending. No generic reset command is provided:
unknown consumption must not silently become retry permission. A held/consumed
event is also not automatically replayed after changes to source/package/policy.

## Shared browser ownership

Queued ingestion and enrichment child commands and the configured owner all run
through `scripts/with-browser-ownership.py` using the same POSIX kernel lease.
Python 3 and `fcntl` are required (macOS/Linux). The persistent lock inode is never
unlinked and has no age/PID takeover. Its descriptor is inherited by the command;
a killed wrapper cannot make a live child appear abandoned. Kernel cleanup after
all holders exit permits recovery. A busy lease refuses the command rather than
launching a competing browser owner. Owner adapters must stay foreground, retain
the inherited descriptor for their browser lifetime, and not leave detached
browser-driving children after they acknowledge completion.

The default lease is `work/locks/shared-browser.lock`. Profiles/worktrees sharing a
real desktop must configure **the same absolute** `browser.ownershipLock` in
`resume-os.config.json`. Other shared-browser entry points must use this same
wrapper, e.g. `python3 scripts/with-browser-ownership.py --lock <same-path> -- <argv>`.
Standalone/manual agents, legacy private owners and scripts that do not adopt the
contract are not magically protected. The collector's dedicated headless browser
remains isolated and keeps its own profile lock. Rendering is browser-independent
and is not leased through the shared desktop lock.

## Verification boundary

`node scripts/test-pipeline-handoff.mjs` exercises the normal worker with fictional
jobs and real injected owner subprocesses, including incremental delivery before an
unrelated failure, exact acknowledgments, policy stops, overlapping schedulers,
aliases, crashes and a live child surviving a killed browser-lock wrapper. Existing
queue/stop regressions remain applicable. This does not exercise live Chrome,
employer submission. `node scripts/test-application-owner.mjs` additionally runs
the normal worker through the real configured foreground owner and guarded executor
on intercepted fictional HTTPS forms in disposable Chrome. It checks incremental
consumption, journal-before-POST, receipt-before-applied, uncertain retry protection,
review defaults, opt-in revocation, package/profile/path refusals and exact aliases.
These receipts are synthetic fixture evidence, never live employer applications.
Neither suite activates a candidate policy, deploys an owner or repairs Chrome.
