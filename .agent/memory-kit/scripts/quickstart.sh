#!/usr/bin/env bash
# Agent Memory Kit — one-command quickstart
# Usage: cd your-project && curl -sL https://aommi.github.io/agent-memory-kit/quickstart.sh | bash
set -euo pipefail

KIT_DIR=".agent/memory-kit"

echo "→ Cloning agent-memory-kit..."
if [ -d "$KIT_DIR" ]; then
  echo "  .agent/memory-kit already exists — skipping clone."
else
  git clone --depth 1 https://github.com/aommi/agent-memory-kit.git "$KIT_DIR" 2>&1 | tail -1
fi

PROJECT=$(basename "$PWD")
echo "→ Initializing project config for '$PROJECT'..."
python3 "$KIT_DIR/generate.py" init << EOF
$PROJECT
Memory kit for $PROJECT

y
y
n
n
n
n
n
n
y
n
y
EOF

echo "→ Generating agent configs..."
python3 "$KIT_DIR/generate.py" all

echo ""
echo "Done. Memory files created in memory/"
echo "Agent configs generated:"
ls -1 CLAUDE.md AGENTS.md 2>/dev/null || true
