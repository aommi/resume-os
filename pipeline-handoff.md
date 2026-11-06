# Incremental enrichment → owner review

This is an opt-in execution contract, not application authorization. An enriched job
is factual source material, **not** a fit decision, reviewed package, attempted
application, or receipt-confirmed application. The tracked form-assist workflow
remains non-submit. No application owner is bundled or selected by this harness.

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

The request's `mode: review-only` prohibits submission, even if an independently
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
`work/pipeline-stop.json` or `work/linkedin-stop.json` prevents dispatch. The wrapper
rechecks gates immediately before child execution, after acquiring browser ownership.
The supervisor polls cancellation/policy while the child runs, terminates its
process group on revocation, timeout, SIGTERM or SIGINT (TERM, up to five seconds
of cleanup grace, then KILL), and records an uncertain result rather than retry
permission. `timeoutMs` bounds execution before this additional cleanup grace.
The owner must also check cancellation/policy at meaningful work boundaries;
polling does not replace any final submit guard.

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
IDs are saved; this harness never writes application lifecycle or counts receipts.

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
aliases, crashes, a live child surviving a killed browser-lock wrapper, and a
TERM-ignoring owner/descendant timing out without releasing the lease early or
replaying uncertain work. Existing
queue/stop regressions remain applicable. This does not exercise live Chrome,
employer submission or the unpublished private application automation stack. This
PR makes the reusable review handoff available; it does not activate candidate
policy, repair Chrome, or claim autonomous receipt-confirmed applications.
