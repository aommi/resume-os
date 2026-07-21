# Resolver: task → which docs to load

The resolver is the thin routing layer that replaces "load everything every session." Instead of reading
all four skill docs on boot, an agent identifies the task and loads only what that task needs. The routing
table is data: `engine/resolver.json`. The deterministic lookup is `engine/resolve.mjs` (tested by
`scripts/test-resolver.mjs`).

## How it works

1. Identify the task type. Known tasks: `tailor`, `score`, `cover_letter`, `resume_maintenance`,
   `model_eval`, `pipeline_status`, `discover`.
2. Load `always` docs (the active profile's `resume-project-tracker.md`) plus the task's route.
3. **Unknown or ambiguous intent → the `default` route** (`resume-os.md` + `tailoring-methodology.md`).
   This is the safety net: the sparse resolver degrades to roughly the old cold-start behavior, so it is
   never worse than the monolith it replaces.

| Task | Loads (beyond `always`) | Notes |
|---|---|---|
| `tailor` | resume-os.md, tailoring-methodology.md, bullet-rubric.md, eval-rubric.md | full tailoring |
| `score` | eval-rubric.md, tailoring-methodology.md | ship check (deterministic gates run in `score-resume.mjs`) |
| `cover_letter` | resume-os.md, tailoring-methodology.md | cover letter skill |
| `resume_maintenance` | resume-os.md, bullet-rubric.md | base-resume edits, not job-specific |
| `model_eval` | evals/model-comparison.md | two-layer model comparison and approval gate |
| `pipeline_status` | (none) | just run `node scripts/job-board.mjs` |
| `discover` | (none) | run scrapers (Hermes); facts only |
| _unknown_ | resume-os.md, tailoring-methodology.md | **fallback** |

## Programmatic use

```bash
node scripts/test-resolver.mjs        # deterministic route assertions (zero model cost)
node -e "import('./engine/resolve.mjs').then(m=>console.log(m.routeDocs('tailor')))"
```

Edit routes by editing `engine/resolver.json` (not code). Re-run `scripts/test-resolver.mjs` after changes
(update its expectations to match).

## Entry points (adapters)

Runtimes enter through a thin adapter that calls this resolver, keeping the routing core runtime-neutral:

- `adapters/claude-code-bootstrap.md`, the Claude Code session bootstrap.
- Other runtimes (Codex, an SDK harness, Cowork) would add their own adapter that reads the same table.
