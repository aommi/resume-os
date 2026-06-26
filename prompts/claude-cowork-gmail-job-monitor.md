# Claude/Cowork Daily Gmail Job Monitor Prompt

Use this prompt for a daily Claude/Cowork run that reads Gmail and writes job-application events into this repo. The repo imports these events later; Cowork must not edit tracker state directly.

```text
Daily job-application email monitor.

Goal:
Review my Gmail for job-application events and write a structured event file for my resume-os-v2 tracker. Do not update the tracker directly. Do not touch any email: no send, reply, label, archive, or delete. Read only. Do not include unrelated personal email content.

Repo context:
The tracker repo is local at:
~/Documents/Resume CV/Resume Project/resume-os-v2

Active profile: amirali (see resume-os.config.json -> activeProfile). ALL working data
for this repo lives under that profile's work dir: profiles/amirali/work/. Never write to
the repo root (root inbox/, events/, etc. are gitignored and ignored by the tooling).

The repo uses:
- profiles/amirali/work/inbox/<job-id>/metadata.json as the source of truth. These files contain applyUrl, company, role, and lifecycle fields such as appliedAt.
- profiles/amirali/work/jobs-tracker.md as a generated board.
- profiles/amirali/work/events/pending/ as the event handoff queue.

Task:
1. Read tracked jobs from profiles/amirali/work/jobs-tracker.md and their profiles/amirali/work/inbox/<job-id>/metadata.json files. You need each job's job_id, company, role, applyUrl, ATS/apply domain, status, and appliedAt if present.
2. Search Gmail with a fixed overlapping window: newer_than:3d. Overlap is intentional and safe because the importer dedups by message_id. Do not try to compute "since last run."
3. Capture only these event types:
   - confirmation: application submitted / thank you for applying
   - rejection: not selected / moving forward with other candidates
   - recruiter_screen: recruiter reached out / phone screen / intro call
   - interview: interview invite / scheduling / assessment / next step
   - offer: offer / compensation / final steps
   - recruiter_lead: recruiter or contact shares a new role I have not applied to yet, asks whether I am interested, says they will send a JD, or asks me to apply
   - other: job-related but unclear
4. Match emails to tracked jobs in this priority:
   - LinkedIn job_id
   - company name
   - ATS/apply domain inferred from applyUrl
   - role title only as supporting evidence, never the sole match
5. Prefer precision over recall. If unsure, set confidence: low and leave job_id blank. Low-confidence events go to human review and should not be treated as automatic status updates.
6. Never mark rejection, recruiter_screen, interview, or offer unless the email clearly says so.
7. Search is not limited to already-applied jobs. A confirmation for a package-ready or to-apply job is valuable because it may catch an application I forgot to report.
8. Distinguish recruiter/application states:
   - Use recruiter_lead when the email is about a new opportunity I have not applied to yet. Examples: recruiter says they will send a JD, asks if I am interested, suggests I apply, or shares salary/location/details for a new role.
   - Use recruiter_screen only when the email clearly moves an existing application or specific opportunity into a screening conversation, phone screen, intro call, or scheduled recruiter discussion.
   - If recruiter outreach mentions a company/role not in the tracker, leave job_id blank and use recruiter_lead unless there is already a screen/interview scheduled.
9. If an email is a password, account setup, verification code, reset link, or login credential email, never include credential content, links, codes, or passwords. Use only redacted evidence such as "[account setup email received]".

Output:
Create one file at:
~/Documents/Resume CV/Resume Project/resume-os-v2/profiles/amirali/work/events/pending/YYYY-MM-DD-HH-mm-claude-gmail.md

Create directories if missing.

Header the file with the search window used:

## RUN_META
- searched_after: YYYY-MM-DD
- checked_at: YYYY-MM-DD HH:mm

Then add one block per relevant email:

## JOB_EMAIL_EVENT
- job_id:
- company:
- role:
- event: confirmation | rejection | recruiter_lead | recruiter_screen | interview | offer | other
- event_date: YYYY-MM-DD
- subject:
- sender:
- message_id:
- thread_id:
- confidence: high | medium | low
- evidence:
- notes:

Evidence must be a short snippet only. Never include the full email body.

If no relevant emails are found, still write the file with RUN_META plus:

## NO_JOB_EMAIL_EVENTS
- notes: No relevant job-application emails found.

After writing the file, report:
- number of events found
- high-confidence count
- low-confidence / needs-review count
- event file path
```

## Import Contract

The future importer should consume files from `profiles/<activeProfile>/work/events/pending/`, deduplicate on `message_id`, archive consumed files to `profiles/<activeProfile>/work/events/archive/`, and send malformed or ambiguous events to `profiles/<activeProfile>/work/events/rejected/` or `profiles/<activeProfile>/work/events/digest.md` for review.

## Review Status Convention

Event files are immutable inputs from external agents. Do not edit existing event blocks after the file is written. When a human or local agent reviews a file, add a separate review entry to `profiles/<activeProfile>/work/events/reviews.md` instead of editing the event file.

Review entries should use:

```md
## EVENT_FILE_REVIEW
- file: profiles/<activeProfile>/work/events/pending/YYYY-MM-DD-HH-mm-claude-gmail.md
- reviewed_at: YYYY-MM-DD HH:mm
- reviewed_by: agent-or-human-name
- model: model-name-if-known
- decision: import_ready | needs_human_review | rejected | duplicate
- notes:
```

The future importer may move files to `events/archive/` after successful import, but should preserve review history in `events/reviews.md`.
