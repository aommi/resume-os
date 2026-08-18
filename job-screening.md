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

## Scoring — the Q/I/A/V tuple

Scoring runs only on jobs that survived the gates above. It answers "in what order do I apply",
never "is this viable" — viability was settled by the gates. The design rule is **subtract**: a
job must be scoreable in about five minutes with the JD and the profile evidence packet open. If a
sub-score needs research, mark it unknown and move on; a decisive unknown is `needs_input`, and an
unknown must never silently count as a pass or a point.

Profile-specific taste feeding these anchors (target industries, mission interests, comp target,
company-size preference) lives in the profile's `LEARNINGS.md` and `positioning.md`, never here.

**Q — qualification fit (0–10), scoring revision `r2`.** Would a cold screen pass this?

Revision `r2` was adopted after the first 16-case retro pass compressed every gate-passing role
into Q8–10. The tighter anchors distinguish direct evidence from a plausible transfer story;
they do not change the weights or rescore the historical worksheet.

- YOE / equivalent scope vs the stated bar (0–2): meets on years or clearly equivalent scope = 2;
  within one year or arguable scope = 1; otherwise 0. A material gap on a firm requirement is a
  hard disqualifier, not a low Q.
- Role shape they need vs shape the candidate has done (0–2): 2 = recent evidence across most of
  the JD's discovery/strategy/execution mix at the requested altitude; 1 = evidence for only part
  of the mix or at an adjacent altitude; 0 = the dominant work is unsupported. Score evidenced
  work, not aspirations.
- Domain evidence (0–3): tag the JD on five axes — industry, customer topology (B2B/B2C/B2B2C/
  two-sided), product structure, commercial motion (SaaS/enterprise/transactional), and product
  problem (e.g. workflow automation, operational efficiency). 3 = at least one recent, tellable
  resume story matches the product problem plus three other axes, including the role's core
  customer or commercial context; 2 = the product problem matches but the customer, industry, or
  commercial context is adjacent; 1 = transferable mechanics only; 0 = none. Keyword overlap
  without a tellable story scores nothing.
- Remaining non-gating requirements covered (0–3): preferred qualifications, tools,
  certifications, named industry experience. 3 = all meaningful items have direct evidence;
  2 = one meaningful item is adjacent; 1 = several rely on transfer assumptions; 0 = little
  evidence beyond the gate minimum. Anything genuinely mandatory and unmet already failed the
  gate; nothing hard can be additive here.

**I — interest (0–10).** Would the candidate take it?

- Mission alignment (0–3), industry pull (0–3), business-model preference (0–2), role shape the
  candidate wants (0–2) — all judged against the profile's stated preferences.

**A — access (0–4).** Will a human see the application?

- Connection (0/1/2): none / second-degree / warm first-degree or referral.
- Company history (0/1/2): from the company-history summary below — cold or unknown = 0; known
  company or prior response = 1; warm relationship, finalist history, or invited back = 2.
  A `do not retry` restriction blocks only jobs within its recorded scope (see the wrap-up).

**PV — platform visibility (0/1), outside A.** The deterministic top-applicant / match signal.
`PV1` means exactly one thing: a verified `top_applicant` result scoped to the current job (the
hardened `topApplicant` signal or an explicit `--assess-match` result). Everything else —
`false`, `unknown`, `high`/`medium`/`low`, stale, or unverified — is `PV0`. It is a
low-confidence summary label, never proven access, so it contributes nothing to the rank index
yet — it is recorded in the tuple so prospective outcomes can test whether it predicts responses
independently of referrals and relationships. Only outcome evidence may promote it into A.

**V — value (0–5).** Is it worth having?

- Comp vs the profile target (0–2): at or above = 2, within ~15% below = 1, far below = 0.
  Absent comp is unknown, scored 1, and flagged — never treated as low.
- Company-size fit (0–2), other constraints such as location friction (0–1).

## Lanes

The lane comes from Q and I only. Access and value never change a lane — a warm contact at a
company the candidate is unqualified for makes them visible, not qualified.

| Lane | Condition | Meaning |
|---|---|---|
| **Focus** | Q ≥ 7 and I ≥ 7 | Qualified and wanted. Worked first. |
| **Stretch** | I ≥ 7 and Q 4–6 | Wanted, not fully qualified. Stays visible, never hidden behind Focus. |
| **Qualified** | Q ≥ 7 and I < 7 | Credible but low-pull. Volume lane; usually `base_resume`. |
| below both | — | Screen as `skip` unless a gate said `needs_input`, with one exception: warm access + I ≥ 7 creates an ACT-NOW Stretch entry (below). |

Lanes are ranked separately and must be grouped manually in the screening report or retro
worksheet — nothing on the board sorts or groups them. Any policy that interleaves them into one queue
is a search-goal decision made by the human at the time, not a constant of this doc.

## The act-now rule

When a gate-passed job has **I ≥ 7 and warm access** (connection = 2, or company history = 2),
surface it immediately at the top of its lane, marked `ACT-NOW`. This overrides the Q-based lane
floor: if Q < 4 would normally mean skip, warm access + I ≥ 7 instead places the job in Stretch
as an explicit ACT-NOW exception — hard gates still apply and are never overridden. The point is
speed: the human should ping the connection while the posting is fresh, before scoring subtleties
are litigated. Warm access overrides posting age — an older posting still qualifies provided the
role is confirmed open (a closed or expired role never enters ACT-NOW; that is viability, which
the gates own). Screening only flags and proposes the outreach as a human decision — it never
contacts anyone (see the output contract).

## Ranking within a lane

The rank index estimates expected value: an index of how likely a human reads the application and
the candidate clears a screen, times what the role is worth. It is an **index, not a calibrated
probability** — the additive access term reflects the candidate's observed history, not measured
odds. Range 0–130 (the freshness multiplier can exceed 100).

```
screenChanceIndex = 0.6 × Q/10 + 0.4 × A/4    (additive — access can compensate for lower Q)
freshness         = ×1.3 (< 3 days) | ×1.0 (< 14 days) | ×0.6 (older)
value             = 0.6 × I/10 + 0.4 × V/5
rankIndex         = round(100 × screenChanceIndex × freshness × value)
```

Worked examples: Q8 I9 A2 V4 → screenChanceIndex 0.68, value 0.86, at f1.0 rankIndex 58.
Q5 I9 A4 V3 → 0.70 × 0.78 = 0.546, at f1.3 rankIndex 71.

Recorded assumptions, to be revisited only when prospective outcome data says so: access is
additive, not a multiplier on Q. The first retro sample supports keeping access strong, but its
3/3 human-process result was partly definitional because all A2 cases began through a recruiter or
referral. The cleaner descriptive depth result was A2: 2/3 reached a hiring-manager or panel stage,
versus A0: 1/9. Trail also showed that A0 must never mean zero opportunity. No Q×A interaction term;
the sample cannot estimate one. Weights are starting points, tuned via the validation protocol,
never mid-screen or mid-cohort.

Freshness decays after scoring, so a stored rankIndex goes stale: recompute the freshness band
(and rankIndex) at the start of each application session for anything scored more than a few days
ago. The stored tuple records the scoring date and multiplier so staleness is visible.

## Recording the score

The compact tuple goes in the existing `lifecycle.priority` field via `--priority`:

```
F-58 r2 (Q8 I9 A2 V4 PV1 f1.0 @2026-08-14)
ACT-NOW S-71 r2 (Q5 I9 A4 V3 PV0 f1.3 @2026-08-14)
```

— lane letter (F/Q/S), rankIndex, scoring revision, sub-scores, platform visibility, freshness
multiplier used, and scoring date. Historical tuples without a revision are `r1`. **The board
displays this string but does not parse, sort, or group by it.** In the current manual workflow,
the ranked queue is assembled manually (the retro worksheet, or eyeballing the column); a
deterministic `rank` command is added only after the anchors survive validation.

The `--reason` clause is the durable record of the decision basis. **Every gate pass persists a
compact pass basis** — an apparent pass can rest on a false premise, and only a recorded basis
lets that be discovered later. Example:

```
PASS: Canada remote confirmed; 8+ YOE met via equivalent scope (assumption:
platform PM scope ≈ stated fintech YOE bar); all mandatory reqs supported;
no credential blocker.
```

Name every assumption. Fails and unknowns quote their JD evidence as before. Sub-score
worksheets and longer confidence notes stay in the screening report, not per job.

---

## Company history and relationship wrap-up

Prior processes are stored as facts, profile-locally in `profiles/<id>/company-history.md`
(create it on the first entry; one section per company). Three record types, never collapsed into
one number or one ordinal:

1. **Process facts:** stages reached, steps passed, interviewers met, direct feedback received,
   invitations or rejections.
2. **Terminal outcome:** active, rejected, withdrawn, ghosted, offer, accepted, declined,
   role closed.
3. **Relationship wrap-up**, written when a process ends: recruiter relationship,
   hiring-manager relationship, LinkedIn connection status, explicit invitation to stay in touch
   or reapply, and a conclusion — future access `better | same | worse | unknown` and retry
   recommendation `yes | conditional | no | unknown` — each with the evidence that supports it.
   Any restriction carries an explicit scope: `company | business unit | team | role family |
   person`. A rejection by itself does not prove even the rejecting person is a future barrier;
   record a barrier, at any scope, only when evidence supports it. `do not retry` blocks only
   jobs within its recorded scope, never the whole employer by default.

Distinguish fact from inference: "connected on LinkedIn" and "invited to reapply" are facts;
"we seemed to click" is an inference unless supported by their words or later behaviour. A
conclusion without cited evidence is `unknown`.

From these facts derive one categorical summary consumed by the A anchor: `cold`,
`known company`, `warm recruiter relationship`, `warm hiring-team relationship`, `invited back`,
`mixed history`, `do not retry` (scoped). A rejection closes one requisition, not the employer;
whether anyone involved is a future barrier is a separate, evidence-backed judgment. Numeric
effects beyond the 0/1/2 anchor are assigned only if the historical data ever supports them.

## Validation protocol — before trusting the ranks

The first 16-case historical pass established a baseline and exposed Q compression. Do not run a
second historical holdout after an anchor change when outcomes are already familiar. Validate `r2`
prospectively on new discoveries, which are blind by construction because outcomes do not yet exist:

1. Freeze `scoringRevision`, the tuple, `scoredAt`, posting age, freshness multiplier, material
   strategy, access source, and `stageAtScore` before applying or before any new process step. Never
   rewrite a frozen score after an outcome; a later rubric change begins a new revision and cohort.
   Recruiter or hiring-manager outreach sent after scoring is a treatment, not access that existed
   at score time: record its target, send time, and response separately, and never retroactively
   increase frozen A because outreach was sent or answered.
2. Record `maxStageAfterScore` and terminal outcome separately. Access must be evaluated on progress
   beyond `stageAtScore`, not on a recruiter conversation or referral that already existed when A
   was assigned. Keep relationship residue separate from both stage depth and terminal outcome.
3. Bucket checks, no regression at this sample size: hiring-manager/panel depth and progression by
   A band; screen progression by Q band with A held constant, especially A0; where finalists and
   offers cluster; response or progression by PV with A held low; response and progression by
   post-score outreach with Q, A, freshness, and material strategy held as comparable as the small
   sample permits.
4. Control for material strategy (tailored vs base) and posting age at apply. Treat active cases as
   right-censored, not failures. Silence is weak evidence and counts only after the case is closed or
   has reached the cohort's declared maturity window.
5. Revisit after about 15 new applications are resolved or sufficiently mature, not merely after 15
   are submitted. Do not change anchors or weights mid-cohort. A low-scored finalist indicts an
   anchor; a high-scored ghost proves nothing. Fix anchor wording before weights.

Keep the completed baseline in `work/retro-screening.md`. Record the prospective cohort
profile-locally in `work/prospective-screening.md`, grouped by lane, with one row per case containing
the frozen inputs above, stage progression, terminal outcome, and any anchor that misfired. Nothing
on the board assembles or evaluates this cohort automatically.

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

### Tailoring approval and legacy recovery

`apply + tailor` is a recommendation, not package approval. A human must run
`node scripts/job-board.mjs approve-tailor <job-id|company>` before the role enters the package queue.
Any later re-screen clears that approval. `lifecycle.screenQuestion` stores the single focused
question for `needs_input`; it never overwrites general `notes`.

For old discovery rows that entered `to_apply` before screening existed, run
`node scripts/job-board.mjs migrate-screening` to inspect candidates, then add `--apply` to move only
rows with no `pursue` value and no package path back to `to_review`.
