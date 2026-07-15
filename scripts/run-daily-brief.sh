#!/usr/bin/env bash
# Daily brief wrapper: read pipeline -> compose brief -> deliver to Telegram, with
# heartbeat contract. Scheduled by a LaunchAgent (daily, after the morning gmail-sync).
# Machine specifics live OUTSIDE this script: the LaunchAgent/environment must provide
# a PATH containing node and the hermes CLI, and BRIEF_SEND_TARGET (e.g. a
# "telegram:<dm name>" target from `hermes send --list`). The target is required
# explicitly — never defaulted — so the brief can't fall through to a group chat.
# The ONLY model call is the brief composition; heartbeat + delivery are deterministic
# (`hermes send` reuses gateway credentials with no LLM and no agent loop).
# -e: initialization must fail closed — a broken cd, node, or mkdir must abort,
# never continue with an empty WORK. Exits we inspect are captured via if-blocks.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${RESUME_OS_BRIEF_LOG:-$HOME/Library/Logs/resume-os-daily-brief.log}"
cd "$REPO"

# Resolve the active profile's work dir through engine config (never hardcode a profile).
WORK="$(node --input-type=module -e "import { workDir } from './engine/config.mjs'; console.log(workDir());")"
if [ -z "$WORK" ] || [ ! -d "$WORK" ]; then
  echo "FATAL: could not resolve work dir (got: '$WORK')" >&2
  exit 1
fi
HB_DIR="$WORK/heartbeats"
HB_FILE="$HB_DIR/daily-brief.json"
mkdir -p "$HB_DIR"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
ATTEMPT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LAST_SUCCESS="$(node -e "try{console.log(require('$HB_FILE').lastSuccess||'')}catch{console.log('')}" 2>/dev/null || echo "")"
BRIEF_MODEL="${BRIEF_MODEL:-deepseek-v4-pro}"

# The wrapper is the single authority on the heartbeat: the agent is read-only and
# never writes it. Success is recorded only after delivery succeeds.
write_hb() { # $1=lastSuccess $2=exitCode $3=failureCategory
  printf '{"workflow":"daily-brief","cadenceMinutes":1440,"lastAttempt":"%s","lastSuccess":"%s","exitCode":%s,"failureCategory":"%s","runId":"%s","model":"%s"}\n' \
    "$ATTEMPT" "$1" "$2" "$3" "$RUN_ID" "$BRIEF_MODEL" > "$HB_FILE"
}

# ── Runner seam ──────────────────────────────────────────────────────────
# The brief is a read-only summary job (see engine/models.json daily_brief); it is
# not tied to Hermes. To swap runners (e.g. claude -p), replace run_brief with any
# command that reads $PROMPT and prints ONLY the brief text to stdout.
#
# The wrapper is the single authority on profile resolution: it substitutes the
# resolved work dir into the prompt's <WORK_DIR> placeholder so the agent never
# re-resolves the profile (and cannot desync from RESUME_OS_PROFILE).
PROMPT="$(cat prompts/daily-brief.txt)"
PROMPT="${PROMPT//<WORK_DIR>/$WORK}"
run_brief() {
  hermes chat -q "$PROMPT" \
    --model "$BRIEF_MODEL" \
    -Q \
    -t file \
    --max-turns 30 \
    --ignore-rules
}

echo "=== daily-brief $RUN_ID (model: $BRIEF_MODEL) ===" >> "$LOG"

if [ -z "${BRIEF_SEND_TARGET:-}" ]; then
  echo "FATAL: BRIEF_SEND_TARGET not set — refusing to run (won't guess a delivery target)" >> "$LOG"
  write_hb "$LAST_SUCCESS" 1 "no_send_target"
  exit 1
fi

if BRIEF_TEXT="$(run_brief 2>>"$LOG")"; then
  BRIEF_EXIT=0
else
  BRIEF_EXIT=$?
fi
if [ $BRIEF_EXIT -ne 0 ]; then
  echo "brief agent failed with exit $BRIEF_EXIT" >> "$LOG"
  write_hb "$LAST_SUCCESS" "$BRIEF_EXIT" "agent_failed"
  exit "$BRIEF_EXIT"
fi

# Output contract: an agent run that produced no brief text is a failure, not a
# quiet success (same rule as the gmail monitor's monitor_output_missing).
if [ -z "$(printf '%s' "$BRIEF_TEXT" | tr -d '[:space:]')" ]; then
  echo "brief agent exited 0 but produced no output" >> "$LOG"
  write_hb "$LAST_SUCCESS" 1 "brief_output_missing"
  exit 1
fi

# Deliver via hermes send (deterministic; exits nonzero on failure). Delivery IS the
# deliverable — a failed send is a failed run, so the watchdog can corroborate a
# missing morning message.
if printf '%s\n' "$BRIEF_TEXT" | hermes send --to "$BRIEF_SEND_TARGET" --quiet >> "$LOG" 2>&1; then
  write_hb "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 0 ""
  echo "daily-brief $RUN_ID OK" >> "$LOG"
else
  SEND_EXIT=$?
  echo "delivery failed with exit $SEND_EXIT" >> "$LOG"
  write_hb "$LAST_SUCCESS" "$SEND_EXIT" "delivery_failed"
  exit "$SEND_EXIT"
fi
