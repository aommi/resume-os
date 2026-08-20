#!/usr/bin/env bash
# Daily brief wrapper: send Telegram only for actionable job-search work, with a
# heartbeat contract. Scheduled by a LaunchAgent (daily, after the morning gmail-sync).
# Machine specifics live OUTSIDE this script: the LaunchAgent/environment must provide
# a PATH containing node and the hermes CLI, and BRIEF_SEND_TARGET (e.g. a
# "telegram:<dm name>" target from `hermes send --list`). The target is required
# explicitly — never defaulted — so the brief can't fall through to a group chat.
# The model runs only after a deterministic action gate; heartbeat + delivery are
# deterministic (`hermes send` reuses gateway credentials with no LLM or agent loop).
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
BRIEF_RUNNER_ORDER="${BRIEF_RUNNER_ORDER:-openai,deepseek}"
BRIEF_OPENAI_MODEL="${BRIEF_OPENAI_MODEL:-gpt-5.6-terra}"
BRIEF_DEEPSEEK_MODEL="${BRIEF_DEEPSEEK_MODEL:-deepseek-v4-pro}"
BRIEF_MODEL="unset"

# The wrapper is the single authority on the heartbeat: the agent is read-only and
# never writes it. Success means either a quiet action-gate pass or successful delivery.
write_hb() { # $1=lastSuccess $2=exitCode $3=failureCategory
  printf '{"workflow":"daily-brief","cadenceMinutes":1440,"lastAttempt":"%s","lastSuccess":"%s","exitCode":%s,"failureCategory":"%s","runId":"%s","model":"%s"}\n' \
    "$ATTEMPT" "$1" "$2" "$3" "$RUN_ID" "$BRIEF_MODEL" > "$HB_FILE"
}

# ── Runner seam ──────────────────────────────────────────────────────────
# The brief is a read-only summary job (see engine/models.json daily_brief).
# Runners execute in configured order, advancing only when a runner exits nonzero
# or returns blank output. Add a future runner by defining run_brief_<name> and
# adding its name to BRIEF_RUNNER_ORDER; do not add an unavailable runner merely
# to make the list longer.
#
# The wrapper is the single authority on profile resolution: it substitutes the
# resolved work dir into the prompt's <WORK_DIR> placeholder so the agent never
# re-resolves the profile (and cannot desync from RESUME_OS_PROFILE).
PROMPT="$(cat prompts/daily-brief.txt)"
PROMPT="${PROMPT//<WORK_DIR>/$WORK}"
run_brief_openai() {
  hermes chat -q "$PROMPT" \
    --model "$BRIEF_OPENAI_MODEL" \
    -Q \
    -t file \
    --max-turns 30 \
    --ignore-rules
}

run_brief_deepseek() {
  hermes chat -q "$PROMPT" \
    --provider deepseek \
    --model "$BRIEF_DEEPSEEK_MODEL" \
    -Q \
    -t file \
    --max-turns 30 \
    --ignore-rules
}

run_brief_with_fallback() {
  local runner output exit_code
  local saw_empty_output=0
  local saw_failure=0
  for runner in ${BRIEF_RUNNER_ORDER//,/ }; do
    case "$runner" in
      openai)
        BRIEF_MODEL="$BRIEF_OPENAI_MODEL"
        if output="$(run_brief_openai 2>>"$LOG")"; then
          if [ -n "$(printf '%s' "$output" | tr -d '[:space:]')" ]; then
            BRIEF_TEXT="$output"
            return 0
          fi
          saw_empty_output=1
          echo "brief runner openai exited 0 but produced no output" >> "$LOG"
        else
          exit_code=$?
          saw_failure=1
          echo "brief runner openai failed with exit $exit_code" >> "$LOG"
        fi
        ;;
      deepseek)
        BRIEF_MODEL="$BRIEF_DEEPSEEK_MODEL"
        if output="$(run_brief_deepseek 2>>"$LOG")"; then
          if [ -n "$(printf '%s' "$output" | tr -d '[:space:]')" ]; then
            BRIEF_TEXT="$output"
            return 0
          fi
          saw_empty_output=1
          echo "brief runner deepseek exited 0 but produced no output" >> "$LOG"
        else
          exit_code=$?
          saw_failure=1
          echo "brief runner deepseek failed with exit $exit_code" >> "$LOG"
        fi
        ;;
      *)
        saw_failure=1
        echo "brief runner '$runner' is not configured; skipping" >> "$LOG"
        ;;
    esac
  done
  if [ "$saw_empty_output" -eq 1 ] && [ "$saw_failure" -eq 0 ]; then
    return 2
  fi
  return 1
}

echo "=== daily-brief $RUN_ID (runner order: $BRIEF_RUNNER_ORDER) ===" >> "$LOG"

if [ -z "${BRIEF_SEND_TARGET:-}" ]; then
  echo "FATAL: BRIEF_SEND_TARGET not set — refusing to run (won't guess a delivery target)" >> "$LOG"
  write_hb "$LAST_SUCCESS" 1 "no_send_target"
  exit 1
fi

# Input contract: the board must exist and carry every status heading the action gate
# reads. A quiet pipeline is a valid no-op; a missing or malformed board is
# input_invalid, never a green heartbeat.
BOARD="$WORK/jobs-tracker.md"
BOARD_OK=1
if [ ! -s "$BOARD" ]; then
  echo "input invalid: $BOARD missing or empty" >> "$LOG"
  BOARD_OK=0
else
  for section in "## Upcoming Events" "## To Review" "## To Apply" "## Package Ready" "## Applied" "## Needs Action" "## Interviewing" "## Skipped" "## Closed"; do
    if ! grep -qF "$section" "$BOARD"; then
      echo "input invalid: $BOARD is missing section '$section'" >> "$LOG"
      BOARD_OK=0
    fi
  done
fi
if [ "$BOARD_OK" -ne 1 ]; then
  write_hb "$LAST_SUCCESS" 1 "input_invalid"
  exit 1
fi

section_has_action() { # $1: board heading, $2: row prefix regex
  awk -v heading="$1" -v row="$2" '
    $0 == "## " heading { in_section = 1; next }
    in_section && /^## / { exit }
    in_section && $0 ~ row { found = 1; exit }
    END { exit(found ? 0 : 1) }
  ' "$BOARD"
}

# Do not spend tokens or send routine telemetry. These are the only board states that
# represent a current candidate decision, reply, or interview-preparation obligation.
if ! section_has_action "Upcoming Events" "^- [*][*]" \
  && ! section_has_action "Needs Action" "^[|] [0-9]+ [|]" \
  && ! section_has_action "Interviewing" "^[|] [0-9]+ [|]"; then
  write_hb "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 0 ""
  echo "daily-brief $RUN_ID quiet (no actionable job-search work)" >> "$LOG"
  exit 0
fi

BRIEF_TEXT=""
if run_brief_with_fallback; then
  BRIEF_EXIT=0
else
  BRIEF_EXIT=$?
fi
if [ $BRIEF_EXIT -ne 0 ]; then
  if [ "$BRIEF_EXIT" -eq 2 ]; then
    echo "all brief runners produced no output" >> "$LOG"
    write_hb "$LAST_SUCCESS" 1 "brief_output_missing"
  else
    echo "no brief runner produced usable output" >> "$LOG"
    write_hb "$LAST_SUCCESS" 1 "agent_failed"
  fi
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
