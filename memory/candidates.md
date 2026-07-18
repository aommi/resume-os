# Candidate Memory

Staged lessons awaiting promotion to `semantic.md` or `DECISIONS.md`. Each needs a staged date
and sources. Promote with a `**Why accepted:**` rationale; reject into `candidates.rejected.md`
with a `**Why rejected:**` reason. The diff is the audit trail.

## Stray root inbox jobs need reconciliation
- **Staged:** 2026-06-26
- **Sources:** root `inbox/` (15 entries) vs `profiles/amirali/work/inbox` (166)
A monitor run left job dirs at the repo root. They are gitignored now but invisible to the job
board (which reads the profile work dir). Decide whether to merge them into
`profiles/<id>/work/inbox` or discard.
