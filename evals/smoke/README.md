# Smoke Test Evals

V0 model-change evals use saved model outputs and code-as-judge.

For step-by-step instructions, read `eval-instructions.md`.

Run each case prompt in `cases/<name>.md` through both models, then save the raw responses using the same filename:

```text
outputs/sonnet/<name>.md
outputs/deepseek/<name>.md
```

The script should pair cases and outputs by filename. GPT can be used later for subjective review, but V0 checks should be deterministic code checks only.
