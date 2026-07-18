# Craft Candidates — staging queue for skill-doc improvements

Profile-local staging for reusable craft and judgment observations from application sessions.
Raw evidence stays profile-local because it may name companies, people, and application content.

## Rules

- **Admission:** require a concrete affected output, a counterfactual correction, and a reusable
  test. Appending is optional; never manufacture a lesson to satisfy a session-end ritual.
- **Recurrence:** engine promotion normally requires recurrence across distinct outputs or
  applications. Reviewer agreement is not recurrence. Truth, privacy, and numeric-integrity
  failures are severity exceptions eligible for immediate human review.
- **Routing:** profile taste goes to the profile's `LEARNINGS.md`. New experience facts or claims
  go to the profile's canonical experience source. Domain is a tag, not a separate tier.
- **Promotion:** an agent recommends `PROMOTE`, `KEEP`, or `DROP`; only the human approves
  promotion into an engine skill doc. Sanitize promoted rules into company-independent language.
- **Hygiene:** keep roughly ten or fewer entries. Triage when the queue reaches ten, with a
  monthly fallback when the profile uses `review-schedule.md`.
- **Terminal outcomes:** `PROMOTE` and `DROP` remove the entry. `KEEP` leaves it in the queue with
  a dated triage-history line. A second evidence-free `KEEP` becomes `DROP`. On `PROMOTE`, add
  `(promoted from craft-candidates, YYYY-MM-DD)` to the destination doc before deleting the entry.

**Entry format:** Date · affected output · observed failure · counterfactual correction ·
reusable test · supporting occurrences · proposed destination · tags

**Triage history:** for every `KEEP`, append a dated line such as
`Triage: YYYY-MM-DD — KEEP; no new evidence`. A second evidence-free `KEEP` becomes `DROP`.

**Context:** point `Affected output` to the repo-relative package artifact. Use short tags for
situational context; do not duplicate the job or session narrative already stored in the package.

## Session-end check prompt

The user can say: **"Run the session-end craft check."** The agent then:

> Review this session for craft learnings. Apply the admission test to each candidate: concrete
> affected output, counterfactual correction, and reusable test. If all three are not present,
> do not create an entry. Route profile taste to `LEARNINGS.md`, new experience facts or claims to
> the profile's canonical experience source, and reusable craft judgment here. Never edit engine
> skill docs directly. "Nothing qualified" is a correct and common result. After appending, count
> the queue entries; if there are ten or more, tell the user that triage is due now.

---

## Queue

<!-- Add qualifying entries here. -->
