# Agent Memory Kit

**Give your agent a memory for your repo.** Store durable project context so AI coding agents remember how your codebase works. Markdown in git. No database. No runtime.

**Your agent manages it itself.** The memory files are plain markdown — no API, no SDK, no special tools. Your agent reads them at session start, writes to them after changes, and can even update the kit itself when new versions ship. It speaks your agent's language because it *is* your agent's language.

---

## The ethos

Every design decision is tested against four load-bearing properties:

1. **Every byte of memory is markdown under git.** Audit with `cat`. Review in `git diff`. Grep with `grep`. No binary indexes, no vector DBs.
2. **No process runs between sessions.** Hooks fire and exit. No daemon, no server, no worker. The system disappears into the file tree.
3. **Promotion to durable memory requires a written reason.** No silent auto-graduation. The rationale *is* the audit trail — every fact in `semantic.md` has a `**Why accepted:**` line.
4. **Single-user, local, no telemetry.** State about your project lives in your repo. State about *you* doesn't accumulate anywhere.

These four together are the distinction. Other memory systems make different trade-offs — search quality, autonomous synthesis, monitoring dashboards. This kit bets that **legibility compounds and infrastructure decays**. A markdown file readable in a `git diff` five years from now is a different kind of asset than an embedding index whose schema you no longer remember.

---

## Quick start

```bash
git clone https://github.com/aommi/agent-memory-kit.git
cd your-project
cp -r ../agent-memory-kit .agent/memory-kit
python .agent/memory-kit/generate.py init    # answer 5 prompts
python .agent/memory-kit/generate.py all     # generates configs for your agents
```

That's it. Your project now has:

```
memory/
  semantic.md              # distilled project knowledge (≤500 lines)
  working.md               # current session scratchpad (≤300 lines, gitignored)
  candidates.md            # staged lessons awaiting promotion
  candidates.rejected.md   # rejected claims with reasons (prevents re-litigation)
DECISIONS.md               # append-only architectural decisions log
CLAUDE.md                  # Claude Code entry point (amk-managed section)
AGENTS.md                  # Hermes + Codex entry point
```

The agent reads these files at session start. When you make code changes, hooks prompt it to update memory. When you switch from Claude Code to Hermes mid-project, the memory is still there — same files, same format.

---

## What the agent sees

After `generate.py all`, your Claude Code agent gets `CLAUDE.md` with a section like this:

```markdown
### Memory Discipline

- `memory/semantic.md` — distilled project knowledge; update directly after changes
- `memory/working.md` — live task state; update freely each response
- `DECISIONS.md` — append-only decisions log; update directly after changes
- `memory/candidates.md` — staged lessons awaiting promotion; append candidate claims

**Stage → Graduate promotion:**
- Append candidate claims to candidates.md with a Staged date and Sources list
- To promote: move the claim to semantic.md with a **Why accepted:** rationale
- To reject: move the claim to candidates.rejected.md with a **Why rejected:** reason
- All promotions and rejections are committed separately. The diff *is* the audit trail.
```

The agent now knows: what to write, where to write it, and why. No README required.

---

## Features

**Stage/graduate promotion pipeline.** Facts don't jump straight into durable memory. They pass through `candidates.md` — an append-only staging queue. Promotion to `semantic.md` requires a written `**Why accepted:**` rationale committed in git. Rejected candidates move to `candidates.rejected.md` with a `**Why rejected:**` reason — preventing re-litigation six months later.

**Eval loop.** `eval/replay.py` validates capture files and compares replayed agent behavior against baselines. Intent-bucket normalization maps tool names across harnesses (Claude Code's `Bash` → `shell-exec`, Codex's `execute` → `shell-exec`) so harness vocabulary drift doesn't register as plan instability. Diagnostic only — does not gate infrastructure decisions.

**Configurable approval mode.** Per-file control over whether the agent writes memory directly (`auto`) or proposes changes for human approval (`review`). Set in `project.yaml`. New projects default to all-auto. Existing projects preserve current behavior.

**Sentinel-managed agent configs.** `CLAUDE.md`, `AGENTS.md`, and other generated files use `<!-- amk:start -->` / `<!-- amk:end -->` blocks. Only the managed section is updated on regeneration. Your custom content outside the sentinels is preserved across every `generate.py` run.

**8 agents, one memory.** Claude Code (hooks enforced), Hermes (AGENTS.md), Codex, Cursor, Gemini CLI, Windsurf, OpenClaw, Antigravity. All read the same `memory/` directory. Switch tools mid-project — the memory doesn't reset.

---

## Supported agents

| Agent | Mechanism |
|---|---|
| Claude Code | `CLAUDE.md` + hooks (`preprompt.txt`, `stop.sh`) |
| Hermes | `AGENTS.md` (read at session start) |
| Codex | `AGENTS.md` (read at session start) |
| Cursor | `.cursor/rules/memory.mdc` (auto-attach) |
| Gemini CLI | `GEMINI.md` + `.gemini/context.md` |
| Windsurf | `.windsurfrules` |
| OpenClaw | `.openclaw-system.md` |
| Antigravity | `.agents/rules/` + `.agents/workflows/` |

---

## The memory files

| File | Purpose | Lifespan |
|---|---|---|
| `memory/semantic.md` | Distilled project facts — what's built, where things live | Long-lived, mutable |
| `memory/working.md` | Current session scratchpad — what I'm doing right now | Ephemeral (days) |
| `memory/candidates.md` | Staged lessons awaiting promotion | Queue (weeks) |
| `memory/candidates.rejected.md` | Rejected claims with reasons | Forever (audit) |
| `DECISIONS.md` | Append-only architectural decisions — "we chose X on date Y because Z" | Forever (audit) |
| `dev/[task]/` | Per-task context, plans, and assumptions | Lives with the task |

**Promotion paths:** working → candidates → semantic (with rationale). Vision-planned → semantic (on merge). Context → DECISIONS (before archiving).

---

## Daily workflow

**Claude Code (hooks enforced):**
1. Open terminal, run `claude`
2. Agent reads `semantic.md` + `working.md` automatically
3. After code changes, the stop hook fires — agent inspects the diff and updates memory per approval mode
4. Candidates are appended to `candidates.md` when patterns recur across sessions

**Other agents:**
Manually prompt before tasks: "Read memory/working.md before answering." After significant changes: "Inspect the diff and update memory."

---

## Keeping the kit in sync

The kit is vendored into each repo — no global install, no version drift. To update:

**Ask your agent:** "Update .agent/memory-kit from the latest agent-memory-kit release." The agent handles the copy, regeneration, and drift check.

**Or do it manually:**

```bash
cd your-project
cp -r ../agent-memory-kit/{generate.py,adapters,templates,eval} .agent/memory-kit/
python .agent/memory-kit/generate.py all
```

For 1–5 repos, copy-paste is faster than any automation.

---

## What we explicitly don't build

See [`docs/planning/vision.md`](docs/planning/vision.md) — it's a graveyard of features considered and rejected on ethos grounds: vector DBs, MCP servers, dashboards, skills runtimes, package-manager installs, data flywheels, personal preference layers. Each entry explains *why* and names the load-bearing property it would break.

---

## License

MIT
