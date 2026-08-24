# Interview Post-Processing

Use after a recruiter screen, interview, networking call with a live opportunity, or contract-scope conversation when a transcript or reliable notes exist. The result should make the next move clearer and improve future preparation without turning every call into a performance report.

This skill interprets evidence. It does not authorize sending a thank-you, follow-up, LinkedIn message, or calendar invite. Draft or send those only when the user asks.

## Inputs and storage

Read the transcript or call notes first. Then read only package materials that answer an open question: the job description, strategy, prior prep, recruiter message, or lifecycle record.

Keep the transcript immutable. Write a dated postmortem beside it only when the user wants a durable record. Update the profile-local `work/interview-evidence.md` with compact, source-linked evidence when it will help a later interview. Add only reusable question shapes to `sources/interview-question-bank.md`. Do not put candidate, company, contact, or interview details in engine files or engine memory.

For future transcripts, use:

`interview-transcript-YYYY-MM-DD-<stage>-<counterpart>.md`

Use one of `recruiter-screen`, `hiring-manager`, `functional`, `panel`, `case`, `executive`, `contract-scope`, `offer`, or `other` for `<stage>`. Prefer the person's role for `<counterpart>` when known, such as `digital-merchandiser-katherine`. Do not rename historical files merely for consistency.

Name a durable review `interview-postmortem-YYYY-MM-DD-<stage>.md` in the same package.

## What to extract

Start with a compact record:

- Date, company, role, stage, interviewer(s), and source path.
- Direct external signals: stated interest, concern, decision owner, committed timing, and promised next step.
- Candidate questions and questions asked of the candidate, including the purpose each appears to test.
- Stories or proof points used, interviewer follow-ups, and points that visibly changed the conversation.
- New facts about the company, team, role, success criteria, scope, compensation, process, or constraints.

Separate each conclusion into one of three labels:

- **Direct evidence:** stated in the transcript or written follow-up.
- **Self-observation:** a transcript-grounded assessment of the candidate's answer, such as an answer running long after the interviewer asked for brevity.
- **Inference:** a plausible interpretation that needs confirmation.

Do not turn no feedback, an unanswered question, a generic polite response, or a later rejection into a diagnosis of interview performance.

## The postmortem

Keep only sections supported by the call and useful to a next action.

1. **Outcome and next move.** State where the process stands, who owns the next action, the promised timing, and the precise follow-up condition. If the timing is vague, say so rather than inventing a date.
2. **What changed.** Record only material updates to the role, company, team, process, economics, or work scope. Mark unconfirmed details as inference.
3. **Coaching.** Assess content, structure, and tone against the question asked. Prefer one or two actionable changes over a general score. Tie each to a timestamp or quoted exchange. Preserve what worked when the interviewer asked a useful follow-up, connected it to their need, or gave direct positive feedback.
4. **Preparation audit.** Compare the preparation materials with what the conversation tested. Record what was used, what was missing, and what caused confusion. Do not criticize a prep artifact merely because it was not needed in one call.
5. **Future reuse.** Add evidence to the interview ledger only if it can help prepare for another stage or another company. Add a question to the question bank only when it recurs, exposes a durable answer gap, or is a high-value question shape that can be adapted across companies.

For every reusable question, record: question, questioner or stage, company and role context, what it tested, story or answer used, follow-up signal, source path, and a concrete next-use note. Keep company-specific questions in the package unless the underlying question shape transfers.

## Contact decision

Decide separately whether contact is warranted. Use the contact opportunity assessment in `tailoring-methodology.md` when outreach is in scope. The normal default is to respect the interviewer’s stated timing and channel. A thank-you is not automatic; a status check is appropriate only after the promised window has passed or when the user has a material update.

## Trim aggressively

Exclude transcript filler, generic rapport, speculative scoring, rewritten transcripts, duplicate role summaries, and a long list of possible improvements. Keep a lesson only when it changes the next preparation, the next message, or the user's understanding of the opportunity.

## Historical review

When reviewing older transcripts, first classify each file as a transcript, call notes, prep material, or unclear. Backfill only a compact evidence row for substantive transcripts and notes. Do not fabricate outcomes from files that predate the decision, and do not create postmortems for every historical call unless the user asks.

## Sequential-process check

When two or more stages exist for one opportunity, test the workflow itself: did the earlier postmortem capture the stated next-stage assessment, did its new facts appear in later preparation or outreach, and did it avoid repeating information already known? Use this to improve preparation quality, not to claim that a later result was caused by one answer.

## Future trigger

Treat a newly saved transcript or call-notes file as a pending postmortem. If a confirmed next interview and its preparation exist, update that preparation with only the source-backed facts that change the next conversation: stated assessment, direct feedback, new company context, and one or two delivery rules. Do not rewrite the whole brief.

`scripts/scan-interview-postmortems.mjs` runs after each Gmail event import. It establishes a baseline on its first run, then keeps a profile-local queue at `work/runtime/interview-postmortem-scan.json` for completed, explicitly scheduled interview events. It checks the linked package for a same-day transcript and postmortem; run it with `--backfill` only when deliberately reviewing earlier events. It must not assume that a scheduled call occurred, send messages, infer outcomes, or alter a submitted package. The postmortem and prep update still require the judgment workflow in this skill.

## Preparing a future interview

For an `interview_prep` task, read the profile-local question bank and evidence ledger before preparing the package-specific brief. Use them to validate the brief, not to force old stories into a new role.

- **Recruiter screen:** Check the concise background-and-motivation answer, logistics, compensation response, and one direct role-fit story.
- **Hiring manager:** Check the stated problem, first-90-day hypothesis, relevant decision-making story, and honest domain boundary.
- **Functional, technical, or panel stage:** Check the interviewer disciplines, likely tradeoffs, one strong partnership story, and whether each answer begins with a clear principle before detail.
- **Case or presentation:** Check that the selected example covers discovery, decision, delivery, measurement, and questions under pressure. Do not use the question bank as a case template.

For each item carried forward from the ledger or question bank, name its source and explain why it applies to this stage. Omit it when the role, interviewer, or question does not support the transfer.
