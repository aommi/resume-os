# Application quality and compensation

Judgment instructions for screening, tailoring and application answers. Load the active
profile's optional `application-policy.json` alongside its verified facts and preferences.
`applicationQualityPolicy` and `compensationPolicy` are model-readable instructions, not a
new runtime schema or submission authorization. Existing workflow authority still applies.
If either policy is absent, follow the profile's existing instructions; do not infer consent
or a salary number from the example. See the fictional
[policy example](profiles/example/application-policy.json) for the optional structure.

## Apply the active profile policy

Read the active profile's `applicationQualityPolicy` and `compensationPolicy` before selecting
or preparing a round. A requested strong-match count is a target, not permission to relabel
domain stretches. Read the full employer JD, distinguish direct evidence from adjacency, and
report strong matches and stretches separately. Freeze screening judgment before submission.

For a quality-focused round, record the decisive requirements and their source-backed evidence
in strategy.md. Use the matching approved base; tailor evidence selection and bullet ordering
as well as the headline. The most relevant recent role's first two bullets must carry the
dominant evidence. Review actual page one for visibility; a headline-only change does not meet
this quality policy. Preserve required contracts, employment chronology, titles and claim
boundaries. Required narrative answers use specific verified examples and measured outcomes.
Submitted packages and submitted answers remain frozen; later policy changes apply prospectively.

Salary expectations come from the current profile policy, not a previously submitted answer or
cached personal band. When that policy requests an advertised midpoint, select the employer's
current base-pay band applicable to the candidate's geography and role level, then calculate
`(low + high) / 2`. Keep currency and pay period explicit; do not use a US-only range for a
Canadian role or confuse base salary with bonus, equity, OTE or total compensation. Preserve
the result's precision, rounding only as required by the form. If salary buckets are offered,
select the bucket containing the target and record that representation.

When no applicable range is published and the profile authorizes a market-based expectation,
research current comparable employer ranges matched to country/currency, seniority, scope and
role family. Document the comparables and adjustments that justify the selected number; title
alone is not a benchmark. More senior scope must not silently inherit a lower-level cached
target. This is model judgment, not a hardcoded salary table or parser fallback. Do not treat
missing posted pay as low pay. Resolve ambiguity about currency, pay period or applicable bands
from the employer source; if still unresolved, hold the salary answer without fabricating it.

Record the exact question, applicable range or comparable sources, observation dates,
calculation, currency/period and submitted answer in per-job execution evidence. Reuse portal
lessons, wait for actual save/upload completion, and repeat only after observed validation or
failure. Confirm the employer receipt, reconcile mail separately, close completed tabs and
preserve unfinished/uncertain applications.

## Execution evidence and handoff

Keep all real job evidence under `profiles/<activeProfile>/work/`. In per-job strategy or
execution notes, record fit evidence, unresolved eligibility/location/travel constraints,
compensation provenance and actual outcome. Maintain a running list of jobs requiring
citizenship or travel when the profile requests it. Work authorization, citizenship and
willingness to travel are separate facts; never substitute one for another.

Count an application as submitted only from employer receipt evidence. Keep email-confirmed,
portal-confirmed and uncertain outcomes distinct; reconcile email separately without silently
changing an uncertain outcome into a submission. Before retrying, consult saved portal lessons
and the existing attempt evidence. Leave CAPTCHA-blocked work pending for a later authorized
round. Close only completed task-owned browser tabs, preserving unfinished applications and
unrelated user tabs. Carry remaining strong-match targets and unresolved questions into the
profile-local checkpoint.
