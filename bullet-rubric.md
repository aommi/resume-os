# Resume Bullet Rubric (PM)

Run every bullet through these 7 checks. Score each ✅ / ⚠️ / ❌.
A **keeper** is mostly ✅ with **no ❌ on checks 1–4**. Everything else gets rewritten, cut, or sent to the backup-stories file.

## The 7 checks

1. **Outcome-first** — Opens with the *result*, not the task.
   "Cut launch backlog to 0.13%" — not "Responsible for product onboarding."
2. **Quantified & defensible** — Has a number you could defend under questioning. Oddly specific (6.4%) reads as more credible than round (12%). If you can't reconstruct *how* you got the number, don't use it.
3. **Ownership** — Be precise about both the action you owned and the larger outcome you influenced. Use a strong verb for the owned lever; when the outcome had multiple drivers, scope the result as a contribution rather than implying sole causality (for example, “Built X, helping grow Y” or “Drove X, contributing to Y”). Ask: “Could another team credibly claim this same outcome?” If yes, the outcome clause must be contribution-scoped. Avoid vague formulations such as “helped with,” “responsible for,” “worked on,” or “participated in.”
   *(Promoted from craft-candidates, 2026-07-18.)*
4. **Scannable** — One idea, readable in a single breath. Sell the *what*; leave the *how* for the interview. No tool dumps or jargon.
5. **Signal** — Carries a competency or keyword the *target role* actually wants. (Per-job; re-checked during tailoring.)
6. **Distinct** — Not a near-duplicate of another bullet on the page.
7. **Invites the conversation** — Makes them want to ask "how?" rather than answering everything up front. A great bullet leaves a hook.

## Strong verbs to start with
Built · Led · Shipped · Launched · Owned · Designed · Automated · Cut · Grew · Scaled · Drove · Replaced · Reduced · Raised

## Words to avoid
Responsible for · Helped with · Worked on · Assisted · Utilized · Leveraged (overused) · Spearheaded · Synergy · "various"

## Ordering within a role (which bullet leads)

Order by **impact + relevance, never by chronology.** The reader scans top-down and attention decays fast — the first 1–2 bullets per role do most of the work.

1. **Lead with the bullet that carries the role's narrative thread.** The opener sets the impression for the whole role. It should be your strongest *and* most on-thread line — usually a quantified, defensible outcome.
2. **Strongest/most-relevant next, weakest last.** Quantified outcomes up top; qualitative or supporting bullets lower.
3. **Tailoring swaps the lead.** "Strongest" for the mass-apply resume = highest impact overall. During tailoring, re-rank so the bullet most relevant to *that* job leads — same bullets, new order.
4. **Don't put two similar bullets adjacent** (same metric, same theme) — it reads as templated. Separate them.
5. **Keep the lead bullet scannable.** If your best achievement is also your densest, tighten it — the opener shouldn't be a wall of clauses.
6. **Across roles:** reverse-chronological (standard). Most recent / lead role gets the most bullets and best real estate; older roles taper.

## Whole-resume checks (scan the page, not just the bullet)

- **No repeated metric *values*.** Two bullets both showing "23" or "30%" or "20%" read as estimated/templated even when both are real. Vary which numbers sit near each other; use the exact figure to break a tie (22% not 20% if that's the truth).
- **Vary openers.** Don't start three bullets in one role with "Built…", and don't open back-to-back *roles* with the same phrase ("Built and launched a…"). Same verb repeated = mechanical.
- **One metric type per claim.** Don't pack two different outcomes into one bullet unless it's the flagship.
- **Length budget.** Decide one page vs two up front; the lead role keeps the most bullets, older roles taper.

## Defensibility (titles, claims, links — the verifiable stuff)

- **Titles are the most checkable line on the page.** Never inflate level (PM ≠ Senior PM) or claim a title you didn't hold. Under-stating a real title (e.g., presenting a manager role as IC) is your call and fine. Focus descriptors ("— Cloud Lease Accounting") are fine; fake levels are not.
- **Every metric must survive "how did you measure that?"** A round number you can't reconstruct is worse than no number.
- **Links and projects get the same scrutiny as roles.** If you link a repo or site, the resume must match what a clicker sees there. Don't headline a feature that reads "coming soon" on your own site.
- **Match the source.** Resume ⊆ LinkedIn ⊆ reality. Anything on any resume variant must also appear on LinkedIn; titles must match across both.

## How to reuse it across the two-tier system

- **Exhaustive master file:** every bullet should pass 1–4 and 7. Don't sweat check 5 here — relevance is per-job.
- **The one solid resume:** must be *all keepers*. Re-run the rubric after any edit.
- **Tailoring pass (per job):** re-score only check 5 (Signal) against that specific posting. Swap in higher-relevance bullets from the exhaustive list, tweak language, drop off-target lines.
- **Backup-stories file:** where bullets that fail check 4 (too detailed) or check 2 (can't currently defend the number) go to wait — stored *with* their full context so you remember what they mean later.

---

## Full-resume scan (4-lens scorer) — optional fresh-eyes critique, BASE resumes only

This persona scan is **optional, secondary critique** for the base resumes (`resume.md`, `resume-pm.md`) — directional opinions from fresh eyes, not the eval. For **tailored variants**, the official eval is the feature scorecard: `eval-rubric.md` + `scripts/score-resume.mjs` (run via `tailoring-methodology.md` Phase 2). Paste the resume where shown. Treat the output as a fix-idea list, never as a shipping gate.

> Act as a senior product recruiter, product hiring manager, ATS parser, and PM career coach.
> I'm applying for **Senior Product Manager** roles at AI-forward commerce, marketplace, and ops-heavy platforms.
> Analyze my resume from four perspectives:
>
> **1. ATS Analysis (0–100)** — missing keywords vs. a target JD; keyword coverage without stuffing; title-match. (Formatting/parsing is judged on the EXPORTED PDF, not this text — see note below.)
> **2. Recruiter Analysis (0–100)** — 6-second scan; clarity, impact, credibility; weak/vague/low-value bullets; accomplishments not quantified.
> **3. Product Hiring Manager Analysis (0–100)** — product judgment, ownership, scope, complexity, business impact; do achievements read junior / mid / senior / staff; is it execution-heavy vs. strategy-light; stronger wording.
> **4. AI Screening Analysis (0–100)** — how an LLM-based screener interprets the experience; missing signals for product sense, execution, AI/ML & agents, platform/APIs, growth/activation, commerce/marketplace ops, data fluency.
>
> For every section: strengths · weaknesses · red flags · specific improvements.
> Then: Overall ATS / Recruiter / Hiring Manager / Market Competitiveness scores (0–100).
> Finally: rewrite the 5 weakest bullets, and list the top 10 improvements that would most increase interview callbacks.
> Be brutally honest but realistic. Do not inflate scores. Compare against senior PMs at top AI/commerce/ops companies (e.g., Shopify, Stripe, Faire, Instacart, Flexport, Ramp, plus AI-native startups). Never invent or inflate metrics — flag gaps instead.
>
> Resume:
> [PASTE resume.md HERE]

### `.md` vs. final file — what to review where
- **Content lenses** (recruiter, hiring manager, AI-screen, keyword *presence*): judge on `resume.md`. Content is identical between the markdown and the export.
- **ATS *parsing/formatting*** (the other half of the ATS lens): judge ONLY on the exported **PDF/DOCX**. Columns, text boxes, headers/footers, unusual fonts, and text-rendered-as-image all look fine in `.md` and silently break in a parser.
- **Parse-check:** export → open the PDF → select-all → copy → paste into a plain-text editor. If the text comes out complete and in reading order, ATS will parse it. This is the job of the formatting pass.
