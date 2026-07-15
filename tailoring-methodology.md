# Resume Tailoring Methodology

The systematic process for tailoring a resume to a specific job. Load this file before touching any bullet. It works for any company, any role, with or without internal feedback.

---

## Phase 0: Load Context (do before any editing)

### 0.1 Check locked decisions

Read `resume-project-tracker.md` → "Decisions locked". Anything listed there is frozen unless the user explicitly reopens it in this session. Do not edit, reverse, or relitigate a locked decision — if a tailoring idea conflicts with one, flag the conflict and let the user decide.

### 0.2 Resolve the profile

Pick the base resume before reading further:

- Senior commerce/ecommerce/retail/catalog/marketplace JD → `resume-commerce.md`.
- IC commerce/ecommerce/retail/catalog/marketplace PM JD → `resume-commerce-pm.md`.
- Senior AI workflow / agentic systems / AI agents / AI productivity / AI tooling / evals / human-in-the-loop automation JD → `resume-ai-workflow.md`.
- Product Owner title or PO-framed JD with backlog, requirements, delivery, or stakeholder/vendor bridging → `resume-po.md`, unless a domain-specific base above is clearly stronger; then use that base with PO emphasis.
- Other senior-level JD (Senior PM and up) → `resume.md`.
- Other IC PM / non-senior PM JD → `resume-pm.md`.

Precedence rule: commerce/retail/ecommerce/marketplace domain wins the base when clearly dominant; PO is the default for PO-framed delivery roles; AI wins the emphasis. For example, a Senior AI eCommerce PM role starts from `resume-commerce.md`, then promotes AI workflow proof during tailoring. A generic public-sector or payments-style PO role starts from `resume-po.md`; an ERP/WMS commerce-operations PO can start from a commerce base with PO emphasis if that domain fit is clearly stronger. Ambiguous → default to the senior/general `resume.md` and flag the choice to the user. (This resolves *which base*; it is separate from knowledge routing — which docs load — handled by the cold-start prompt and agent skills.)

### 0.3 Read the JD and write the strategy

Save the raw JD first as `applications/<Company - Role>/job.md` (JD text, source URL, company/job metadata, notes). For LinkedIn job URLs (or any page that blocks plain fetches), do not paste raw HTML into context — run `node scripts/fetch-linkedin-job.mjs "<url>" --out "applications/<Company - Role>/job.md"`. It drives local headless Chrome (the same binary the export script uses), parses the guest-view `og:title` + `show-more-less-html__markup`, and writes clean job.md-ready text; it fails loud on a login wall instead of writing an empty file. This is cheaper and more deterministic than reading the rendered page by hand. Then extract it into `applications/<Company - Role>/strategy.md` before editing the resume. Keep it short for straightforward roles; use the fuller template (`applications/README.md`) only for referral, high-fit, ambiguous, or high-stakes roles.

| Extraction | Example (Shopify Senior PM) |
|---|---|
| **Role archetype** — who does this team build for? | Merchants, retail operators |
| **PM archetype** — what flavor of PM work is this? Cite 2-3 JD anchors. | Builder-first + domain/operator PM; anchors: "prototype quickly," "talk to merchants," "AI tools" |
| **Key problems** — what are they hiring to solve? | Merchant tools, catalog quality, discovery-to-ship velocity |
| **Required signals** — what MUST the resume prove? | Talk to merchants, write code, prototype fast, AI tools, data-driven |
| **Company vocabulary** — their words for your work | "merchant" not "retailer," "build" not "manage," "ship" not "deliver" |
| **Anti-signals** — what would read wrong? | Pure operator/merchandiser framing, no technical depth, no discovery |

If you can't extract at least archetype, key problems, and required signals, re-read the JD. These three drive every tailoring decision.

Keep **role archetype** and **PM archetype** distinct:

- **Role archetype:** who the team builds for and what world the product lives in.
- **PM archetype:** the kind of PM work the JD emphasizes — technical PM, builder-first PM, strategic PM, delivery / PO-style PM, growth / experimentation PM, domain/operator PM, or a mixed archetype.

If the PM archetype conflicts with the base resume choice from 0.2, flag the conflict to the user instead of silently resolving it. Example: an AI-titled role may still read as senior builder-first PM, not IC AI PM.

**Bounded company research:** only if the JD is thin on culture/product signals — spend ≤5 minutes on the company's careers page, product pages, or blog, extract at most 2–3 values or vocabulary signals, and note the source. Research feeds supported soft/company vocabulary and framing only; it never creates claims.

**Keyword elicitation:** write `keywords.md` as a decision table per `eval-rubric.md` §1 and save it in the application folder. The decision table is the per-term source of truth; it feeds the Phase 2 scorer. Label JD language by defensibility:

- **Supported terms:** directly backed by source material; safe for `--terms-hard` or `--terms-soft`.
- **Adjacent terms:** supported by related experience; usable only when phrased carefully.
- **True gaps:** unsupported must-haves; report them, do not include them as resume claims.
- **Context-only terms:** describe the employer's environment more than the candidate's experience. Keep these in `keywords.md`; do not force them into resume bullets or skills.

Use this minimum `keywords.md` table. The **claim boundary** prevents both overclaiming and underselling when the strongest evidence is adjacent rather than exact:

| Term | Category | Coverage | Evidence anchor | Claim boundary | Action |
|---|---|---|---|---|---|
| merchant | company vocabulary | Yes | Summit Outfitters merchandising workflows | May describe merchant-facing workflow discovery; do not claim merchant-platform ownership | Use naturally |
| rollout | role verb | Partial | Summit Outfitters/Tutorly implementation work | May describe supported rollout; do not claim sole change-program ownership | Weave carefully |
| M365 | hard tool | No | None | No supported claim | Gap - do not include |
| procurement | context-only | Context-only | None | Employer context, not a candidate capability | Context only - do not put in skills |

Coverage values: `Yes`, `Partial`, `No`, `Context-only`. Actions: `Use naturally`, `Weave carefully`, `Gap - do not include`, `Context only - do not put in skills`, `Omit intentionally`.

The scorer should receive only supported terms: `--terms-hard` for supported must-haves, `--terms-soft` for supported soft/company vocabulary, and `--terms-context` for context-only or risky employer-world nouns. True gaps must be echoed in the final review notes as REPORT items so they remain visible at ship time.

### 0.4 Read the source material

1. **`exhaustive-experience.md`** — scan parked bullets and backup stories for this role's domain. A parked bullet that was weak for general apply may be strong for this specific JD.
2. **`skills-bank.md`** — check for named tools the JD mentions that are personally backed.
3. **`bullet-rubric.md`** — refresh the 7 checks. You will apply them after editing.

Prior application packages are not source material unless the user explicitly asks, or the wording/story has already been promoted into a base resume, `exhaustive-experience.md`, or `skills-bank.md`. If the selected base resume is missing a stronger relevant story from canonical source material, pull it in deliberately and record it in `tailoring-log.md` when material.

### 0.6 Evidence-lens and dominance pass

Before editing bullets, identify the **one or two dominant evidence stories**: the closest, differentiating, source-backed proof for this role. Record the intended resume location for each in `strategy.md`. Each dominant story must appear within the first two bullets of the most relevant recent role, unless a written constraint makes that impossible. Do not rely on the base resume's current wording as the only interpretation of a story. The same experience can legitimately signal different things depending on the JD:

| Source story | Default/base wording | This JD's lens | Must preserve |
|---|---|---|---|
| Summit Outfitters merchandising pipeline | Commerce automation / add-to-cart lift | Data pipeline / decision support / analytics workflow | Inputs, transformation/curation loop, decision user, measurable impact |
| Catalog Fixit | Product-data issue workflow | Retail staff workflow / data quality / intake operations | User, intake signal, resolution metric |
| Tutorly AI tutoring | AI product / engagement growth | AI routing / product usage analytics / decision automation | Data-science partnership, experiment loop, product-health metric |

If a JD is analytics, data, AI-insights, platform, or decision-support oriented, every relevant pipeline/workflow story must be described with four parts when true: **inputs → transformation/curation → decision/user → metric**. Do not collapse source-backed data work into generic "automation."

For referral, high-fit, ambiguous, or high-stakes applications, add a compact **Requirement-to-Evidence & Visibility** table to `strategy.md`. It is not an ATS keyword list; its purpose is to catch proof that is technically present but buried.

| JD requirement | Candidate evidence | Resume location | Visibility | Claim boundary |
|---|---|---|---|---|
| search / recommender familiarity | Existing recommendation workflow | MEC bullet 2 | Top of page one | Operationalized workflow; not platform/model ownership |

Use `Top of page one`, `Mid-page`, `Skills-only`, `Absent`, or `Intentionally omitted` for visibility. A must-have that is only skills-level or below the first role block is a fix candidate, not a pass.

### 0.5 Load feedback (if it exists)

If internal/referral feedback exists for this role, load it. If not, the taste rules (Phase 1, step 10) carry you. Do not stall on missing feedback.

---

## Phase 1: First-Pass Tailoring

Run these steps in order. Each step builds on the previous.

### Step 1: Role archetype translation

Frame every role through the lens of the target company's user. "Built an automated merchandising pipeline" means something different to Shopify (merchant tools) vs. a retailer (internal ops efficiency). The same bullet, different emphasis.

Rule: translate the *framing*, not the facts. Never claim experience you don't have.

### Step 1.5: PM archetype language alignment

Use the PM archetype from `strategy.md` to decide what the resume should sound like:

- **Technical PM:** emphasize platform/API/data/integration tradeoffs, technical ambiguity, and engineering partnership.
- **Builder-first PM:** emphasize hands-on prototyping, AI/dev tools, 0-to-1 workflow building, and fast learning loops. The PM value is not "uses tools"; it is shortening the path from idea to user feedback, validation, clearer specs, and better product decisions.
- **Strategic PM:** emphasize market/customer insight, roadmap choices, business outcomes, and executive-level tradeoffs.
- **Delivery / PO-style PM:** emphasize requirements clarity, stakeholder coordination, backlog discipline, and predictable execution.
- **Growth / experimentation PM:** emphasize funnels, activation, analytics, experiments, conversion, and iteration.
- **Domain/operator PM:** emphasize deep workflow understanding, operator/user empathy, industry context, and practical adoption.
- **Mixed archetype:** prioritize the blend explicitly; do not try to signal every PM competency equally.

This changes vocabulary, bullet order, and which proof gets promoted. It does not change facts, titles, dates, or metrics.

### Step 2: Vocabulary map

For each problem the JD cares about, map their term to your real, evidenced experience:

| JD term | Your real experience | Evidence anchor |
|---|---|---|
| "merchant empathy" | Retail floor staff + merchandising team discovery at Summit Outfitters | exhaustive-experience.md CFX section |
| "rapid prototyping" | Python/Lovable/AI coding tools for internal tools at Summit Outfitters | skills-bank.md, Summit Outfitters bullet 4 |
| "data-driven experimentation" | Partnered with data science on activation experiments at Tutorly | Tutorly bullet 2 |

Only map terms the base resume, `exhaustive-experience.md`, `skills-bank.md`, or explicit user input genuinely supports. Empty mappings are red flags — the JD asks for something you can't back. Flag it, don't fabricate.

Rule: JD nouns that describe the employer's internal world are not skills. Terms like a specific platform, department, stakeholder group, or operating surface can appear in `keywords.md` as context, but should not appear in the resume skills block unless there is a concrete story the candidate can defend in an interview.

Before marking a term `Partial` or `No`, scan the current base resume, `exhaustive-experience.md`, `skills-bank.md`, and explicit current-session input. If evidence exists outside the selected base resume, pull it in only from those canonical sources.

### Step 3: Discovery signal insertion

When the JD values customer/user empathy, weave discovery into at least 2 roles. Name who you talked to (retail staff, enterprise customers, students, tutors). Never as a standalone bullet — woven into an existing bullet's front half:

Good: "Ran workflow discovery with retail staff and merchandising teams, then built Catalog Fixit..."
Bad: "Conducted user research across multiple personas to identify pain points."

If the JD is neutral on discovery, one signal is sufficient. If it's central (Shopify, any consumer role), ensure it appears across 2+ roles as a pattern, not a one-off.

### Step 4: Builder proof promotion

If the JD asks for coding, prototyping, or AI tooling, move it from the skills section into experience or project bullets. A named tool in the skills list is invisible to a skimmer. The same tool in a bullet ("Prototyped internal workflows in Python, Lovable, and AI coding tools") proves you actually use it.

Rule: at least one experience bullet must show hands-on technical work if the JD asks for it.

Second rule: the tool is not the headline. Whenever possible, connect tools/prototypes to the product loop they improved: understanding high-friction processes, validating with users, simplifying spec writing, de-risking engineering investment, adoption, or change management.

For AI-forward roles, also load the active profile's positioning frame (`profiles/<activeProfile>/positioning.md`) before writing the headline, summary, or project bullets. Use that philosophy to keep the resume from collapsing into a tool list.

### Step 5: PM craft encoding

If this is a PM role, ensure three signals are explicit in at least one bullet each:

1. **Prioritization** — how you chose what to build ("prioritize activation experiments, double down on highest-leverage levers")
2. **Experimentation design** — structured approach to testing ("partnering with data science to analyze drop-offs, run structured experiments")
3. **Dispatch/execution** — how work got defined and shipped ("define scope, turn work into tickets, dispatch implementation agents")

These can live in experience bullets OR project bullets. JobForge's development loop bullet is a valid dispatch signal. Tutorly's experimentation bullet is valid for both prioritization and experimentation.

Do not add a standalone "PM process" bullet. It reads as filler.

### Step 6: Bullet re-ranking

Within each role, reorder bullets by relevance to THIS job, not by general impact. The lead bullet per role does 60% of the work — make it the one most relevant to the JD.

Rule: quantified, defensible, on-thread bullet first. Qualitative or supporting bullets lower. Never chronology. The dominant evidence stories from Phase 0.6 take precedence: they must occupy the first two bullets of the most relevant recent role. If a more general roadmap opener needs to remain first, place the dominant proof second.

### Step 7: Selective bolding

Bold the scan anchor: the product/system name OR the primary metric. Not both in the same bullet. **Target-role relevance wins before metric magnitude:** a directly relevant product, system, adoption outcome, or domain phrase is a stronger anchor than a larger but less relevant number. Never bold implementation details, architectural choices, or internal mechanism names.

Test: "Would a recruiter repeat this phrase in a phone screen?" If yes, bold it. If no, strip it.

Good: **messaging-first AI agent**, **multi-model development loop**, **~20% lift in add-to-cart**
Bad: **source-of-truth profiles**, **tiered review**, **agent-ready tickets**

### Step 8: Skills section swap

Match the JD's keyword surface with backed claims from skills-bank.md. Add tools only if:
- They're named in the JD AND you have personal stories to back them
- They're already in skills-bank.md

Remove skills irrelevant to this role if space is tight. A shorter, targeted skills block reads as more credible than a kitchen-sink list.

Hiring-manager smell test: every skill must sound like a real capability, not a copied JD noun. Remove phrases that only name the target employer's environment or internal process unless they are grounded in bullet-level experience. If a term is useful for context but not defensible as a skill, move it to `keywords.md` under context-only / gaps.

### Step 9: Headline/summary tailoring

Always review and rewrite the fit summary/headline for the target job. Do not carry the base resume headline or a prior package summary forward unchanged unless it is still the best fit after reading the JD.

For referral/high-fit applications: a short summary at the top is allowed. It frames the archetype before the reader parses bullets. Use the company's vocabulary.

For cold applications: the one-line headline is sufficient. No multi-line summary.

If adding a summary: 2 sentences max, up to ~4 rendered lines when merged with the headline into a single block (the user prefers headline and summary merged, not stacked separately). It should read as: "I understand this role's world, and here's my spine."

### Step 10: Pre-flight taste check

Run this checklist against every bullet before proceeding to evaluation. These are universal — they apply to every role, every time.

- [ ] **Discovery preserved** — no bullet lost a customer/user empathy signal that was in the source
- [ ] **Bolding correct** — product names or primary metrics bolded; no implementation details bolded
- [ ] **No duplicate openers** — adjacent bullets don't start with the same verb or phrase
- [ ] **One idea per bullet** — scannable in a single breath, no overloaded clauses
- [ ] **Numbers defensible** — every metric survives "how did you measure that?"; oddly specific > round
- [ ] **PM framing** — bullets read as PM work (systems, strategy, ownership), not operator/executor tasks
- [ ] **PM archetype fit** — vocabulary and responsibility framing match the JD-backed PM archetype in `strategy.md`
- [ ] **Evidence completeness** — more relevant source-backed stories outside the selected base resume were considered and either pulled in or intentionally omitted
- [ ] **Evidence dominance** — the one or two closest evidence stories are in the first two bullets of the most relevant recent role; the Requirement-to-Evidence & Visibility table (when required) has no must-have that is merely skills-level or buried
- [ ] **Evidence lens preserved** — source-backed work is framed through this JD's lens; analytics/data roles preserve pipeline inputs, transformation/curation, decision user, and metric where supported
- [ ] **Claim boundaries preserved** — adjacent evidence is framed at its verified level of ownership; no candidate claim crosses the boundary recorded in `keywords.md`
- [ ] **Claims ⊆ LinkedIn** — any new or strengthened claim exists on LinkedIn or will be added
- [ ] **No tool dumps** — project bullets describe what was built and how, not a list of tools
- [ ] **Older roles compressed** — Corealign and Vantix stay lean to fund proof in Summit Outfitters/Tutorly/Projects
- [ ] **Chronology coherent** — if Vantix or all pre-2019 experience is dropped, do not keep dated pre-2016 education lines; either omit B.Eng. entirely or keep it undated only when it adds clear role value. If the headline says "8+ years," keep enough experience on-page to support it or remove the years claim.
- [ ] **No repeated metric values** — two bullets showing "23" or "30%" adjacent reads as templated
- [ ] **Skills pass hiring-manager smell test** — no context-only JD nouns or invented pseudo-skills in the skills block

If any box is unchecked, fix it now. Do not proceed to evaluation with known taste violations.

If tailoring materially changes role emphasis, pulls in a source-backed story not present in the selected base resume, or intentionally omits a visible JD gap, create/update `tailoring-log.md` with: base resume used, strategy/keywords paths, material changes, source pulls, intentional omissions, and waivers. Keep this as a separate file; do not append hidden comments to `resume.md`.

---

## Phase 2: Ship Check (feature scorecard)

The eval is `eval-rubric.md`: concrete feature checks with statuses **PASS / FAIL / REPORT / WAIVED**. No invented quality percentages, no persona scores — the question is "can this resume ship, and what concrete issues remain?"

1. Build to a temp dir (no `--deliver` yet):
   ```bash
   node scripts/build-resume-formats.mjs --source "applications/<Company - Role>/resume.md" \
     --out-dir /private/tmp/resume-export --resume-title "<Company Role>" --export
   ```
2. Run the deterministic scorer with the supported terms from `keywords.md`:
   ```bash
   node scripts/score-resume.mjs --source "applications/<Company - Role>/resume.md" \
     --html "/private/tmp/resume-export/<Full Name> - <Company Role>.html" \
     --pdf "/private/tmp/resume-export/<Full Name> - <Company Role>.pdf" \
     --terms-hard "<supported must-haves>" --terms-soft "<supported soft/company vocabulary>" \
     --terms-context "<context-only JD terms>"
   ```
   Use `--terms-context` only for employer-world vocabulary that should not gate shipping. It reports when those terms appear in the `## SKILLS` section so keyword stuffing is visible without forcing a fail. Do not pass true gaps to `--terms-hard` just to make the scorer loud; report true gaps in the final review notes instead.
3. Fix every **HARD** failure — these block shipping. An UNVERIFIED hard gate also blocks (a gate you can't check is not a gate you passed).
4. Fix **SOFT** failures, or WAIVE each with a one-line written reason. REPORT lines are informational.
5. Run the latent checklist from `eval-rubric.md` §3 — truth/groundedness is a hard gate; outcome-first, PM framing, and natural vocabulary report failing bullets by name.
6. Max 3 fix iterations, then ship. Present the final scorecard, true gaps / intentional omissions, and any waivers verbatim alongside the resume — real statuses, not summaries.

---

## Phase 3: Export & Verify

### 3.1 Build, deliver, and machine-verify (one command)

```bash
node scripts/build-resume-formats.mjs --source "applications/<Company - Role>/resume.md" \
  --out-dir /private/tmp/resume-export --resume-title "<Company Role>" --export \
  --deliver "applications/<Company - Role>" \
  --require-terms "<5-8 key JD terms, comma-separated>"
```

`--deliver` copies the exact default build into the application folder as a single human-facing upload PDF that starts with `<Full Name>`, e.g. `<Full Name> - <Company Role> - Resume.pdf`, plus `resume.html`. (There is no separate generic `resume.pdf` — the named PDF is the one and only deliverable PDF; tooling that needs to score a PDF uses the temp export dir, not the package.) Never glob-copy from the export dir; it may contain optional extra variants when flags such as `--with-narrow` are used. It then runs deterministic checks and prints `verify:` lines: page count must be 2, all `--require-terms` must parse from the PDF text, and extraction must not come back empty. The command exits non-zero on failure — do not deliver a failing build.

### 3.2 Human/agent checks (the part the script can't do)

- [ ] Bolding renders correctly (right anchors, nothing over-bolded)
- [ ] Bullet markers render as full circles and are not clipped by the left margin
- [ ] Role headers render cleanly: title on its own line/area, company + location separated below, dates aligned right; no title/company/team text concatenated into one run-on line
- [ ] No widowed bullets (single line orphaned on next page)
- [ ] First page passes a 6-second recruiter scan: role-relevant lead bullets, scannable metrics

When touching `scripts/build-resume-formats.mjs` or regenerating a package after renderer changes, export at least one representative resume and inspect the generated PNG/PDF visually before delivery. Page count and PDF text extraction are necessary but not sufficient; layout regressions such as clipped bullets or collapsed role headers must block shipping.

---

## Phase 4: Application Package & Outcome Tracking

A complete application package in `applications/<Company - Role>/` contains:

- `resume.md` + `resume.html` + `<Full Name> - <Company Role> - Resume.pdf` (delivered via `--deliver` in Phase 3; the named PDF is the single upload file)
- `strategy.md`
- `keywords.md`
- `tailoring-log.md` when material changes or omissions need review visibility
- `cover_letter.md`
- `answers.md` — **only when real form/screening questions exist** (pasted by the user, or scraped from the apply page). Do **not** pre-generate answers to imagined questions. Record each as **question · answer-as-submitted · date**; once submitted, the answers freeze (submitted-package freeze rule). Standard, reusable facts (work authorization, background check, "previously worked here," how-you-heard, salary band, location) are **not** regenerated per app — they live once in `application-profile.md`. Surface any new claim an answer relies on to the candidate queue in `exhaustive-experience.md`. (Full design + future automation: `os-planning/backlog-horsepower-and-reuse.md` (APP-3/APP-4); original design in `os-planning/archive/application-questions-plan.md`.)
- saved JD and notes from Phase 0

Non-resume artifacts obey the same truth gate: claims ⊆ resume ⊆ LinkedIn ⊆ reality. The cover letter draws only from resume facts and the Phase 0 vocabulary map — it may reframe and emphasize, never introduce new claims.

Cover letters are short by default and follow `resume-os.md` → "Cover Letter Skill": one short opener, 3-4 bullets mapping JD requirements to source-backed proof, one short close, and contact info. Use a paragraph-only letter only when the user asks for that style or the application prompt expects it. Keep `cover_letter.md`, generated `cover_letter.html`, and a name-leading upload PDF in the package when a cover letter is needed. Generate the PDF with Chrome header/footer disabled (`--no-pdf-header-footer --print-to-pdf-no-header`) and verify there are no visible browser headers/footers before calling the package complete. LinkedIn/InMail messages need a punchy subject and should stay around 4 short lines.

Finally, record application lifecycle changes through `node scripts/job-board.mjs`, which updates `inbox/<job-id>/metadata.json` and regenerates `jobs-tracker.md`. Do not hand-edit `jobs-tracker.md`; it is a generated board. Keep `resume-project-tracker.md` for OS state, locked resume decisions, and process changes. After ~10 applications, revisit `eval-rubric.md` gates against real outcomes from the generated tracker and underlying lifecycle metadata.

---

## Pitfalls (from past sessions)

Lessons learned from real tailoring sessions. New pitfalls get appended here — this file is the single home for session-learned judgment; do not copy these into agent-level skill/config files.

**Over-compression drops essential signals.** When compressing bullets to fit the 2-page budget, agents tend to drop discovery/customer-empathy signals first. These are the hardest thing to add back and the most valued by hiring managers. Cut the least-relevant *outcome* bullet, never the discovery signal.

**Wrong bolding anchors.** Agents bold implementation details (e.g., "source-of-truth profiles") instead of product names or metrics (e.g., "messaging-first AI agent"). The test is Step 7's: would a recruiter repeat it in a 6-second scan? If no, strip it.

**PM craft left implicit.** Outcomes read strong but the reader can't see how the candidate works. Surface prioritization, experimentation design, and dispatch/ticketing explicitly (Step 5). The Tutorly 1M-to-3M bullet is the natural home for experimentation/prioritization; the JobForge development loop bullet for dispatch/ticketing.

**Duplicate openers not caught before delivery.** Scan adjacent bullets for repeated openers before showing the user. "Ran workflow discovery..." appearing twice in Summit Outfitters is the canonical example. Fix the second occurrence, not the first.

**Flattening strong evidence into generic automation.** Analytics/data/AI-insights roles need the actual data story, not a commerce shorthand. The Summit Outfitters merchandising pipeline is not merely "automated curated collections"; for analytics roles it is a data pipeline using sales data, merchant targets in Power BI, and shopper behavior signals to collect/score/curate campaign collections and drive add-to-cart. Preserve inputs, curation logic, decision user, and impact.

**Older-role over-embellishment.** Corealign and Vantix are older, less strategic roles. Do not weave discovery signals or PM craft into them — keep them clean and compressed. The discovery pattern belongs in Summit Outfitters, Tutorly, and Projects.

**Numbers lose their baseline in rewrites.** "Reviewed within 3 business days" means nothing without "from up to 4 weeks." When rewriting a before/after bullet, the baseline is the impact — preserve both ends or cut the number entirely.

**Skills keyword stuffing is worse than a missing keyword.** Recent Fasken/BPP passes showed the failure mode: JD nouns like "procurement," "project portfolio," "LMS," or "Canadian regulatory" can get stuffed into skills to appease the scorer. This reads badly to hiring managers and can overclaim. Keep employer-context vocabulary in `keywords.md`; put only defensible capabilities in skills.

**Tool-user framing is weaker than product-learning framing.** For AI/dev-tooling roles, don't reduce the story to "uses Claude/Codex/Hermes/Cursor and builds things." The stronger PM signal is that AI and agentic coding compress the loop from workflow discovery to prototype, user feedback, validation, sharper specs, and adoption/change management. Tools can be named, but the hiring-manager takeaway should be faster product learning and better decisions.

**Dropping old roles can expose education-date gaps.** If a tailored resume drops Vantix or all pre-2019 experience, keeping a dated B.Eng. line can create an apparent 2012-2016 gap and make the resume look accidentally edited. Default fix: omit B.Eng. when Vantix is omitted. If the B.Eng. is genuinely useful for a technical role, keep it undated. If the headline claims "8+ years," keep compressed older experience or remove the years claim.

---

## Quick Reference: What To Do When...

**You don't have internal feedback:** The taste rules (Phase 1, step 10) carry you. They encode the user's preferences from past sessions. The ship check (Phase 2) catches what taste rules miss.

**The JD is vague:** Extract whatever you can. If the archetype is unclear, default to the role's most likely user. A "Senior PM" at a commerce company builds for merchants until proven otherwise.

**You're over 2 pages:** Cut in this order: (1) compress Corealign to 1 bullet, (2) drop the weakest Summit Outfitters or Tutorly bullet, (3) compress Vantix to 1 bullet. Never cut discovery signals or builder proof to save space.

**You drop Vantix or all pre-2019 work:** Remove the dated B.Eng. line by default. Keeping the B.Eng. with 2008-2012 dates while experience starts in 2019 creates an unnecessary chronology question. If B.Eng. matters for the target, keep it undated and record the decision in `tailoring-log.md`.

**A soft check keeps failing after 3 iterations:** WAIVE it with a written reason and ship. Some gaps are real experience gaps, not wording problems. The methodology's job is to surface them honestly, not to paper over them. (Hard gates are never waivable — if a hard gate can't pass, stop and tell the user.)

**The user gives feedback mid-session:** Apply it, re-run the ship check, present the updated scorecard. Do not restart from Phase 0 unless the feedback changes the archetype or fundamental framing.

---

## Relationship to Other Files

| File | Role in tailoring |
|---|---|
| `tailoring-methodology.md` (this file) | Entry point. The engine. |
| `resume-os.md` | Stable rules, content model, narrative spine. Reference, don't modify during tailoring. |
| `eval-rubric.md` | The tailored-resume eval: keyword decision table, hard/soft/report ship gates, latent checklist. Phase 2 runs it. |
| `scripts/score-resume.mjs` | Deterministic scorer for eval-rubric's mechanical checks. Exit non-zero = hard gate failed. |
| `bullet-rubric.md` | 7-check bullet quality — run after every edit. Its 4-lens persona scan is optional fresh-eyes critique for *base* resumes only. |
| `exhaustive-experience.md` | Parked bullets and backup stories. Scan before tailoring for stronger proof. |
| `skills-bank.md` | Named tools and variant skill sets. Swap per JD. |
| `resume-project-tracker.md` | Current state. Check for locked decisions before editing. |
| `cold-start-prompt.md` | Bootstrap. Tells agent to load this methodology first. |
| `applications/<role>/resume.md` | The tailored output. What gets built. |
| `applications/<role>/tailoring-brief.md` | Optional: role-specific feedback, reviewer notes, known pitfalls. Load in Phase 0 if it exists. |
