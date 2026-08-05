# Application Form Assist

Judgment and operating rules for using browser automation to fill job-application forms. This is a
separate workflow from screening and tailoring: screening decides whether to pursue, tailoring builds
the package, and form assist helps prepare a browser session for human review.

## Boundary

- The script may open an application URL, fill known profile fields, attach package files, and leave
  the browser open.
- The script must never submit, send, finish, or complete an application.
- The script must never invent answers. Blank is safer than guessed.
- The script may use a manifest to map selectors to profile fields or pre-approved answer text.
- Private manifests with real applications and answers live under `profiles/<activeProfile>/work/`
  or other ignored scratch, never in reusable engine files.
- Tracked examples must use fictional profile data and fictional/demo application URLs only.

## Inputs

1. A submitted or ready-to-submit application package under the active profile's `work/applications/`.
2. The active profile's `profile.json` for contact and standard ATS answers.
3. A form-assist manifest naming:
   - `url`: application form URL.
   - optional `clickBeforeFill`: only for opening/revealing the form.
   - `fields`: selectors and either `valueFrom` profile keys or explicit manifest values.
   - `fileUploads`: selectors and package-relative resume/cover-letter files.

## What belongs in code vs. manifest vs. judgment

Code (`scripts/apply-form-assist.mjs`) does deterministic actions only:

- load active profile and manifest
- resolve profile/work paths
- fill fields by selector
- select dropdown options by visible text
- check/uncheck boolean fields
- attach files
- refuse final-submit-like clicks
- hold the browser for review

Manifest supplies runtime specifics:

- target URL
- selectors for a specific ATS/form
- which profile field maps to each selector
- pre-approved, application-specific answer text
- package file path

Agent/human judgment decides:

- whether a custom answer is defensible
- whether a field should be left blank
- whether a missing field requires user input
- whether the reviewed application should be submitted manually

## Use

Dry-run the manifest first:

```bash
RESUME_OS_PROFILE=example node scripts/apply-form-assist.mjs --manifest profiles/example/work/application-form-example.json --dry-run
```

Run the browser assist only after reviewing the dry-run plan:

```bash
node scripts/apply-form-assist.mjs --manifest profiles/<activeProfile>/work/<private-manifest>.json
```

The script leaves the browser open and reports each filled/skipped field. Review manually and submit
outside the script only when the application is correct.

## Manifest value keys

Supported `valueFrom` keys include:

- `profile.fullName`, `profile.firstName`, `profile.lastName`
- `profile.email`, `profile.phone`, `profile.addressLine1`, `profile.city`, `profile.province`,
  `profile.postalCode`, `profile.country`, `profile.resumeLocation`
- `profile.linkedin`, `profile.github`
- `ats.previouslyWorkedForCompany`, `ats.applicationType`, `ats.legallyAbleToWork`,
  `ats.willingBackgroundCheck`, `ats.criminalOffenceNoPardon`, `ats.accommodationsRequired`,
  `ats.howDidYouHear`

Use explicit `value` only for text already approved for this application. If an answer needs taste,
source grounding, or user confirmation, leave it out of the manifest until decided.

## Anti-patterns

- Hardcoding real candidate details, job URLs, or answers in `scripts/`.
- Reusing one company's selectors as if they are a universal form schema.
- Clicking a final submit button or adding an escape hatch that allows submission.
- Filling years, salary, work authorization, sponsorship, relocation, demographic, or legal fields by
  guesswork.
- Treating a filled browser as a submitted application.
