# Job Screening — deciding what to pursue

Judgment doc for triaging a discovered-jobs backlog into action tiers. Consumed via the
`job_screening` resolver route. Companion to `tailoring-methodology.md`: screening decides
*whether* a job is worth work, tailoring decides *how* to do that work.

This doc holds judgment only. Every threshold, parse, and state transition named here lives in
deterministic tooling — do not re-implement any of it in prose, and do not encode candidate-specific
taste here (that belongs in the profile's `LEARNINGS.md`).

---

## Inputs

- The job records under the active profile's `work/inbox/<job-id>/metadata.json`, including the
  full `description`.
- The profile's `LEARNINGS.md` (candidate-specific taste: domains, comp floor, location reality).
- The profile's `positioning.md` and `profile.json` `jobSearch` block.
- The current tracker, to detect roles already in flight.

## Deterministic gates run first — do not re-judge them

These are settled in code before judgment begins. Treat their output as fact:

| Gate | Owner |
|---|---|
| Excluded companies | `engine/job-exclusions.mjs` |
| Compensation parse (fails closed to "not available") | `engine/compensation.mjs` |
| LinkedIn assessment eligibility | `scripts/assess-jobs.mjs` |
| Lifecycle transitions | `scripts/job-board.mjs` |

If a gate looks wrong, that is a bug report, not a screening decision.

---

## The one rule that matters most

**Never assign a job to an action tier without reading its description.**

Titles and metadata sort candidates. Only the JD decides the tier. Screening that skips this step
fails in a specific, repeatable way: it promotes roles that a single sentence in the body would
have eliminated. Every field below has been observed contradicting the JD it came from.

## Fields that must be confirmed against the body text

| Field | Failure mode |
|---|---|
| `location` | Records a metro the role is not open in; the JD names required offices elsewhere |
| `compensation` | Historically parsed stray figures; now fails closed, so absence means unknown, never unpaid |
| `topApplicant` | Contaminated on records ingested before signal hardening; unreliable past ~2 weeks |
| `title` | Level words (Staff, Principal, Lead) do not reliably indicate the stated experience bar |

Read the JD for: where the work is physically required, the stated years and domain bar, and
whether an unmatched requirement is genuinely disqualifying.

---

## Hard disqualifiers

Cull without further judgment when the JD shows any of:

- **An unmatched *required* qualification the candidate cannot claim.** Where an assessment panel
  records required-qualification counts, a shortfall blocks the tier regardless of any headline
  match label. Quote the specific requirement in the rejection.
- **A location requirement the candidate cannot meet.** Named offices with mandatory attendance,
  or a country the candidate is not authorized to work in.
- **A domain that requires credentials or a profession the candidate does not have.** Distinguish
  this from an unfamiliar industry: a workflow platform in a new vertical is learnable; a role
  demanding practising-professional background or a distinct engineering discipline is not.
- **The posting is stale.** Age thresholds are profile taste; see `LEARNINGS.md`.
- **The listing is not a real employer posting.** Aggregators and staffing intermediaries where the
  hiring employer is unidentifiable.
- **A role already in flight.** Cross-check company and title against the tracker before pursuing.
  Duplicate requisitions and records from different sources for one role are common.
- **Unpaid, volunteer, or below-entry roles.** These are not "overqualified", they are out of scope.

## Not a disqualifier

- **Being overqualified.** If the stated bar is met, the role is in play. Under-levelled
  applications do convert.
- **A level above the candidate's current title**, when the stated experience bar is met and the
  fit is genuine. A loose fit at a higher level is a cull; a strong fit is not.
- **An unfamiliar industry**, where the underlying product work is the same.
- **A stalled or ghosted process at the company.** That closes one requisition, not the employer.

---

## Tiers

Assign exactly one. Prefer a short, high-conviction top tier over a long one.

**BUILD PACKAGE** — strong fit, worth a tailored resume and cover letter. The candidate clears the
stated bar, the domain is claimable from real evidence, and the location and comp are workable.

**BASE RESUME** — the candidate qualifies but the strategic fit is loose. Worth an application
using an existing base resume variant, not bespoke work. This tier exists so that qualifying roles
are not lost to a fit bar set for a different purpose; it is a volume play and its cost per
application must stay near zero.

**WATCH** — the employer matters but this requisition is weak, or a disqualifier is suspected but
unconfirmed. Name the specific thing to confirm.

**CULL** — quote the disqualifier.

## Output contract — a proposal, never an action

Screening **proposes**; it does not apply, message, or transition lifecycle state. Every outward-
facing step stays human-initiated. This is what keeps an automated screen from acting on the
candidate's behalf, and it is not negotiable.

Persist an accepted screen with `node scripts/job-board.mjs screen <job-id> --fit <tier> --reason
"..." [--priority <value>] [--variant <base>]`. This records the proposal in existing lifecycle
fields and deliberately does not change the job's status.

For every screened job emit: job id, employer, role, tier, a one-clause reason, and the proposed
next action. For every cull, the quoted disqualifying text from the JD. For every BUILD PACKAGE,
the suggested base-resume variant.

Proposed actions by tier:

| Tier | Proposal |
|---|---|
| BUILD PACKAGE | Build a tailored package. Then run the match assessment on this job specifically, as corroboration before further investment. |
| BASE RESUME | Apply with the named base-resume variant. No tailoring. |
| WATCH | Confirm the named uncertainty. |
| CULL | None. |

**Referral and outreach proposals.** When the screen rates a job a strong fit *and* an independent
match assessment agrees at its top level, additionally propose: identify existing connections at the
employer, and identify the recruiter or hiring manager. Emit this as a prompt for the human to act
on. Never schedule it, never batch it, and never let an unattended run perform people search — that
is account-endangering activity on the candidate's own identity, and its value is highest at exactly
the moment a human has decided to apply anyway.

Require both signals to agree before proposing outreach. The reason is cost asymmetry, not a
measured constant: outreach spends a real relationship and cannot be undone, so it should wait for
corroboration. Treat any specific claim about how well a match label predicts fit as **provisional
and profile-local** until a given profile has its own evidence.

Group culls by reason with the ids listed per reason so they can be actioned in bulk. Do not
enumerate every cull individually.

Report data-quality problems separately from screening decisions: duplicate requisitions, records
whose employer field holds a location or a job title, records sharing one package path, and any
field that contradicted its JD.

---

## Anti-patterns

- **Ranking on the headline match label.** In the one backlog measured so far, a top match label
  predicted the screening outcome no better than the tier below it — a single-profile observation,
  not an engine-wide constant. The general point holds regardless: a label is a summary, whereas
  required-qualification completeness names a specific thing the candidate lacks. Prefer the
  disqualifier; use the label only to order what already survived. Profiles should check this
  against their own results rather than inherit the finding.
- **Treating a missing compensation value as a low salary.** Absent means unparsed.
- **Marking everything "maybe".** A screen that defers every call has done no work.
- **Promoting on freshness and comp alone.** Recency and a large number are the two fields most
  likely to be present, which makes them the two most likely to be the only thing considered.
- **Re-deriving the criteria per run.** Rules learned while screening belong in this doc (general)
  or the profile's `LEARNINGS.md` (candidate-specific), not in the next ad-hoc prompt.
