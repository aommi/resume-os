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
- The profile's `positioning.md`, `profile.json` `jobSearch` block, and verified evidence sources: `sources/exhaustive-experience.md`, `sources/skills-bank.md`, and the applicable base resume. Do not decide that a required domain is absent without checking this evidence packet.
- The current tracker, to detect roles already in flight.

## Screenability gate — before strategic judgment

The screening model receives only a **new, screenable** job. `unavailable` means already applied/interviewing/closed, duplicate, excluded, or confirmed closed: do not screen it. `incomplete` means a JD or decisive fact is missing: return `needs_input` with one focused question. Only `ready` jobs receive a strategic recommendation.

## Deterministic gates run first — do not re-judge them

These are settled in code before judgment begins. Treat their output as fact:

| Gate | Owner |
|---|---|
| Screenability from stored facts | `engine/job-screenability.mjs` |
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
- **A domain that requires credentials or a profession the candidate does not have.** Distinguish
  this from an unfamiliar industry: a workflow platform in a new vertical is learnable; a role
  demanding practising-professional background or a distinct engineering discipline is not.
- **A confirmed location or work-authorisation requirement the candidate cannot meet.** This is a real blocker, not a cheap long shot. A missing or unclear location is `needs_input`, not a skip.
- **Unpaid, volunteer, or below-entry roles.** These are not "overqualified", they are out of scope.

## Not a disqualifier

- **Being overqualified.** If the stated bar is met, the role is in play. Under-levelled
  applications do convert.
- **A level above the candidate's current title**, when the stated experience bar is met and the
  fit is genuine. A loose fit at a higher level is a cull; a strong fit is not.
- **An unfamiliar industry**, where the underlying product work is the same.
- **A stalled or ghosted process at the company.** That closes one requisition, not the employer.

---

## Disposition and strategy

Screening answers two separate questions. Do not overload either one with lifecycle state.

1. **Should we pursue this role?** `apply`, `skip`, or `needs_input`.
2. **If we pursue it, what material strategy is justified?** `base_resume` or `tailor`.

`to_review`, `to_apply`, and later lifecycle statuses remain execution state, not screening labels.
A strategically strong role that is closed or expired is not viable and must never enter
`to_apply`; viability is checked separately from strategic route.

| Pursue | Strategy | Meaning |
|---|---|---|
| `apply` | `base_resume` | A viable, credible fit where bespoke work is unlikely to change the odds. It is a recommendation, not a proxy for "the form is easy" or a personal time-budget decision. |
| `apply` | `tailor` | A targeted evidence story can materially improve the odds; tailoring still needs human confirmation before costly package work. |
| `needs_input` | — | One missing fact would change the decision. Ask exactly one focused question. |
| `skip` | — | Clear non-fit. Quote the JD evidence and retain the record; never delete it. |

## Output contract

Screening never applies, sends outreach, or submits a form. It may persist a reversible internal
disposition using:

```bash
node scripts/job-board.mjs screen <job-id> \
  --pursue <apply|skip|needs_input> \
  --strategy <base_resume|tailor> \
  --reason "..." \
  [--question "..."] [--application-mode <focused|opportunistic>] [--priority <value>] [--variant <base>]
```

`apply` moves the record to `to_apply`; `skip` moves it to `skipped`; `needs_input` stays in
`to_review`. A human may override any screen. Until the triage model has earned autonomous use,
model output should be reviewed or replayed against the private evaluation set before issuing this
command.

`applicationMode` is valid only for `apply`: `focused` is part of the active search; `opportunistic` is an eligible, plausible low-effort long shot. Opportunistic must use `base_resume` and never enters tailoring, outreach, or priority workflows.

For every screened job emit: job id, employer, role, pursue value, strategy and application mode when applicable, and a
one-clause reason. Every skip includes a quoted disqualifying JD passage. Every `needs_input` result
contains exactly one question.

**Referral and outreach proposals.** For a strong `apply` + `tailor` result, screening may propose
outreach as a separate human decision. Never schedule it, batch it, search people automatically, or
send it. Match assessment is optional corroboration, not a gate; its ranking signal is provisional
and profile-local.

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
