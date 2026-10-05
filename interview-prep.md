# Interview Preparation

Use when the user asks to prepare, rehearse, or get ready for an upcoming interview, recruiter call, hiring-manager conversation, technical screen, panel, case, presentation, or the "next step" or "next round" of an active application. Phrases such as "prep me for the next step," "prepare me for tomorrow's interview," and "make interview prep" map to the `interview_prep` route.

This skill owns preparation for a future conversation. Use `interview-postmortem.md` for a completed conversation. Do not provide live interview assistance when the employer prohibits it.

## Establish the confirmed event

Before drafting, identify the latest confirmation or calendar invitation. When email is in scope, read the confirmation and its thread rather than relying on an availability request, an earlier invitation, or a tracker summary.

Confirm:

- date, time, timezone, duration, stage, interviewer, channel, and any stated rules;
- whether a later message supersedes an earlier invitation;
- whether the invitation matches the availability the candidate submitted; and
- which details are confirmed facts versus a likely interpretation of the process.

When invitations conflict, compare their send order, cancellation status, and submitted availability. State the resolved event and the evidence for it. Do not invent a stage from the sequence alone.

## Read the smallest useful evidence set

Use this order, stopping when the brief is well grounded:

1. Latest confirmation, invite, reschedule chain, and recruiter instructions.
2. Package job description, submitted application material, strategy, and lifecycle record.
3. Earlier transcripts and postmortems from the same opportunity.
4. Interviewer material the user supplied, such as a LinkedIn profile or recommendations.
5. The profile-local interview evidence ledger and question bank.
6. Current external research only when the role or company context still has a material gap.

Carry forward facts that change this stage: stated team needs, assessment criteria, direct feedback, process details, and story gaps. Do not restart from the job description when earlier interviews supplied better evidence.

Treat interviewer profiles and recommendations as directional evidence, not a prediction of exact questions. Note the age and source of the material. Use repeated themes to tune question selection and answer emphasis, but never suggest mentioning the recommendations to the interviewer.

When preparation includes product strategy for a live product, verify its current surface before proposing changes. Separate what is generally available, in preview or beta, on the public roadmap, and only a stated North Star. Distinguish maturity by layer when needed: an established core workflow can contain a new marketplace, platform, or business-model bet. Mark ideas that extend existing features as proposals rather than describing shipped capabilities as gaps. If internal incubation or investment criteria are not public, state that boundary and do not infer an approval process from the product timeline.

## Shape the preparation to the stage

Design for the confirmed duration. A 30-minute screen needs fewer, sharper stories and questions than a one-hour panel.

- **Recruiter:** concise background, motivation, role fit, logistics, compensation, and one proof story.
- **Hiring manager:** role problem, relevant outcomes, product judgment, honest domain boundary, and first-principles questions.
- **Functional or technical:** system boundaries, data flow, source of truth, constraints, failure cases, tradeoffs, validation, collaboration, and metrics.
- **Panel:** interviewer disciplines, likely handoffs and disagreements, distinct stories, and consistent claims across answers.
- **Case or presentation:** confirmed format first; then discovery, decision, delivery, measurement, risks, and questions. Do not build a deck before the format is confirmed.

For a technical product answer, use this compact sequence when it fits the question:

1. Ask one clarifying question.
2. Name the users and desired outcome.
3. Define the shared object, data, or workflow.
4. Identify the source of truth, ownership boundaries, and constraints.
5. Cover failure cases and validation.
6. Propose the smallest testable release.
7. Name the measures that would change the decision.

Prefer two or three defensible stories over a large story bank. Give each story a clear use case, decision, candidate contribution, outcome, and honest boundary. Never stretch scale, domain experience, ownership, or technical depth to resemble the employer.

## Deliver a usable brief

Default to a standalone, responsive, printable HTML file in the active application package. It must open directly from disk and must not depend on a running local server. Do not publish or host a disposable prep brief unless the user asks for mobile or remote access. If a Markdown prep file already exists, keep it as the editable source and update both. Otherwise, HTML alone is acceptable unless the user asks for an editable source.

The HTML should support three modes:

- a fast final review with confirmed logistics, the interview thesis, and the few facts to remember;
- rehearsal with likely questions, answer structures, stories, and interviewer questions; and
- printing without clipped text, hidden sections, browser headers, or low-contrast styling.

Use clear navigation and short sections. Put confirmed facts ahead of analysis. Label material inferences. Include sources only where they help the candidate judge confidence; do not turn the brief into a research report.

When the confirmed invitation contains a meeting URL, put a clearly labeled join link in the event summary. Open external meeting links in a new tab with `target="_blank"` and `rel="noopener noreferrer"`. Use the URL from the active invitation, not an earlier or inferred link.

Before delivery:

- render the page and inspect it at desktop and narrow widths;
- check print layout when printing is a plausible use;
- verify anchors, section IDs, overflow, contrast, and missing content;
- run the human-facing writing check; and
- confirm that employer restrictions on live AI assistance are visible when applicable.

If browser security requires a temporary local server for visual QA, stop it after the check and close the preview tab. Deliver the local HTML file path, never the temporary `127.0.0.1` or `localhost` URL.

## Reuse and learning

After completing the brief, assess new methods for reuse. Add a rule here only when it is broadly useful across employers or stages and preserves source boundaries. Keep company facts, interviewer details, and candidate evidence inside the profile package. Send completed-interview learning through `interview-postmortem.md` rather than embedding one interview's conclusions in this skill.
