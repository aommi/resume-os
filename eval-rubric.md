# Eval Rubric — Ship Check for Tailored Resumes

One question: **can this resume ship, and what concrete issues remain?** Statuses are PASS / FAIL / REPORT / WAIVED — no invented quality percentages, no persona scores; mechanical counts are fine. Deterministic checks run in `scripts/score-resume.mjs`; latent checks are an agent checklist. (Base resumes use `bullet-rubric.md`; its 4-lens scan is optional fresh-eyes critique, not the eval.)

## 1. Keyword decision table (once, in Phase 0)

From the JD plus bounded company research:

- **Supported must-haves:** named tools, hard skills, role words the JD explicitly requires and the source material supports. These feed `--terms-hard`.
- **Supported soft/company vocabulary:** their words for the work where the source material supports natural use (e.g. merchant, dogfooding, prototype). These feed `--terms-soft`.
- **Adjacent terms:** related but not direct evidence; use careful wording and feed the scorer only if the final wording is defensible.
- **True gaps:** unsupported must-haves. Report them, do not force them into the resume and do not pass them to `--terms-hard`.
- **Context-only terms:** employer-world vocabulary that describes the target environment but is not a defensible resume claim. Pass these to `--terms-context` only when useful; they are not shipping gates.

Save this as a decision table in `keywords.md`:

| Term | Category | Coverage | Evidence anchor | Action |
|---|---|---|---|---|
| merchant | company vocabulary | Yes | Summit Outfitters merchandising workflows | Use naturally |
| rollout | role verb | Partial | Summit Outfitters/Tutorly implementation work | Weave carefully |
| M365 | hard tool | No | None | Gap - do not include |
| procurement | context-only | Context-only | None | Context only - do not put in skills |

Coverage values: `Yes`, `Partial`, `No`, `Context-only`. Actions: `Use naturally`, `Weave carefully`, `Gap - do not include`, `Context only - do not put in skills`, `Omit intentionally`.

Only supported terms feed the scorer. The final scorer output or review notes must echo true gaps and intentional omissions as REPORT items so they remain visible without creating keyword-stuffing pressure.

Term hygiene: the scorer matches case-insensitive substrings, so prefer multi-word or ≥4-character terms ("Claude Code", "merchant", "SaaS"). Avoid bare short tokens like "AI" or "PM" — they false-pass inside other words; use the phrase they appear in instead ("AI tools", "Senior PM").

## 2. Ship gates

**Hard — a FAIL or UNVERIFIED blocks shipping:**

| Check | Definition |
|---|---|
| `protected_identity_contact_links` | parsed resume name, exact contact-block lines, required contact/project/credential links, and every emitted URL match the active profile's canonical rules |
| `page_fit` | delivered PDF is exactly 2 pages |
| `hard_terms` | every supported must-have term passed via `--terms-hard` parses from the PDF text |
| `banned_words` | zero hits from the words-to-avoid list in `bullet-rubric.md` |
| truth (latent, §3) | zero claims that can't be traced to `exhaustive-experience.md`, the base resume, `skills-bank.md`, or explicit user input |

**Soft — fix, or WAIVE with a one-line written reason:**

| Check | Definition |
|---|---|
| `soft_terms` | every supported soft/company-vocabulary term passed via `--terms-soft` parses from the PDF text |
| `bullet_height` | no bullet renders >2 lines (default-width variant only; Narrow wraps tighter by design and is ignored) |
| `orphan_lines` | no multi-line bullet whose last rendered line has ≤2 words (default variant) |
| `duplicate_openers` | no two adjacent bullets in a section share their first two words |
| `repeated_metrics` | no metric value appears in two or more different bullets |

**REPORT — informational, no gate:** `quantified_ratio` (bullets containing a number / total) · `bold_spans` (bullets with >1 bold span) · `bullet_taper` (bullets per role; recent roles should carry the most) · `suspicious_context_skill` (context-only terms found in the skills block when `--terms-context` is provided) · true gaps / intentional omissions from `keywords.md`.

## 3. Latent checklist (agent review, per bullet)

Output is failing bullets by name — never scores:

- [ ] **Truth/groundedness** (hard gate) — every claim traceable to `exhaustive-experience.md`, the base resume, `skills-bank.md`, or explicit user input; list anything unanchored. For numeric claims, reconcile denominators, distinguish measured/realized results from modeled figures, and preserve qualifiers plus both ends of a comparable before/after boundary and cohort or remove the number. For geography, customer segment, or organizational scope, match the verb to whether the candidate owned delivery, partnered on it, or only advised.
  *(Claim-integrity checks promoted from craft-candidates, 2026-07-18.)*
- [ ] **Outcome/product lead is justified** — outcome-first when the result is owned and verified;
  capability/product-first when a metric would mislead or undersell the story (bullet-rubric check 1)
- [ ] **PM framing** — reads as PM work (systems, strategy, ownership), not an operator/executor task
- [ ] **PM archetype fit** — responsibility language matches the JD-backed PM archetype in `strategy.md` (technical, builder-first, strategic, delivery / PO-style, growth / experimentation, domain/operator, or mixed)
- [ ] **Vocabulary natural** — supported soft/company terms woven into bullet/summary framing, not stuffed into the skills list
- [ ] **Page-one balance** — rendered page one has no conspicuous avoidable empty block; if it does, compare a `--skills-first` build and keep it only if the two-page layout and six-second recruiter scan remain clean
- [ ] **PM competency sweep** (PM roles) — the JD decides which competencies matter; the sweep prevents accidental omissions, it does not require stuffing the resume. From the reference list (prioritization · roadmap · strategy · cross-functional · GTM · tradeoffs/decision-making · understanding customers + business + tech · data-driven · outcome-driven · product analytics · experimentation / A/B testing · builder fluency · AI usage), check the JD-relevant ones and report each as explicit / partial / absent / intentionally omitted. JD-emphasized items that are absent or skills-only are fix candidates; absences backed by a defensibility caveat in `exhaustive-experience.md` are honest gaps — leave them. Record the sweep in the application's `keywords.md`. Do not force all of them into every resume.

Honesty note: latent checks are agent-judged; only the truth gate has an external anchor (traceability to `exhaustive-experience.md`). When practical, have a fresh context that didn't write the bullets run this checklist. The outcome log in `resume-project-tracker.md` is the only real calibration — revisit these gates after ~10 applications.
