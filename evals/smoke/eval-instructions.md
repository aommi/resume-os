# Smoke Eval Instructions

Use these instructions when generating saved model outputs for the V0 smoke evals.

## Goal

Generate raw model responses for each case in `evals/smoke/cases/`, then save them under the matching model output folder.

Do not judge or edit the responses. The checker script will score them later.

## Models

Current output folders:

```text
evals/smoke/outputs/sonnet/
evals/smoke/outputs/deepseek/
```

Use the same case filenames when saving outputs.

Example:

```text
evals/smoke/cases/constraint-retail.md
evals/smoke/outputs/sonnet/constraint-retail.md
evals/smoke/outputs/deepseek/constraint-retail.md
```

## Process

For each file in `evals/smoke/cases/`:

1. Open the case file.
2. Copy the `## Prompt` section and all source/context sections below it.
3. Send that content to the target model.
4. Save the model's raw response to `evals/smoke/outputs/<model>/<same-case-filename>.md`.
5. Do not fix formatting, facts, wording, or mistakes in the model output.

The case file contains the prompt and the ground-truth facts. The output file should contain only the model's response.

## Cases

```text
constraint-retail.md
grounded-edtech.md
grammar-resume.md
skills-finance.md
gap-finance.md
```

## Important Rules

- Do not modify files in `evals/smoke/cases/`.
- Do not summarize the model output.
- Do not add commentary before or after the model output.
- Do not run an LLM judge.
- Do not use GPT to score these outputs.
- Do not change the filename.
- If a model refuses, save the refusal exactly as returned.
- If a model gives multiple alternatives, save the full response exactly as returned.

## After Outputs Are Saved

Run:

```bash
node scripts/smoke-test-model.mjs sonnet deepseek
```

The script pairs files by filename and compares:

- `evals/smoke/cases/<case>.md`
- `evals/smoke/outputs/sonnet/<case>.md`
- `evals/smoke/outputs/deepseek/<case>.md`

## Expected Output Folders

After generation, this should exist:

```text
evals/smoke/outputs/sonnet/constraint-retail.md
evals/smoke/outputs/sonnet/grounded-edtech.md
evals/smoke/outputs/sonnet/grammar-resume.md
evals/smoke/outputs/sonnet/skills-finance.md
evals/smoke/outputs/sonnet/gap-finance.md

evals/smoke/outputs/deepseek/constraint-retail.md
evals/smoke/outputs/deepseek/grounded-edtech.md
evals/smoke/outputs/deepseek/grammar-resume.md
evals/smoke/outputs/deepseek/skills-finance.md
evals/smoke/outputs/deepseek/gap-finance.md
```
