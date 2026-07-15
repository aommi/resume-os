#!/usr/bin/env bash
# Gmail sync wrapper (HLT-2): monitor -> import -> render, with heartbeat contract.
# Scheduled by LaunchAgent ai.resumeos.gmailsync (07:00 + 19:00, user-approved token cost).
# The ONLY model call is the monitor itself; heartbeat + import + render are deterministic.
set -uo pipefail

REPO="/Users/amirali/Documents/Resume CV/Resume Project/resume-os-v2"
LOG="/Users/amirali/Library/Logs/resume-os-gmail-sync.log"
export PATH="/Users/amirali/.local/bin:/Users/amirali/.nvm/versions/node/v24.13.0/bin:/usr/bin:/bin"
cd "$REPO"

HB_DIR="profiles/amirali/work/heartbeats"
HB_FILE="$HB_DIR/gmail-sync.json"
mkdir -p "$HB_DIR"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
ATTEMPT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LAST_SUCCESS="$(node -e "try{console.log(require('$REPO/$HB_FILE').lastSuccess||'')}catch{console.log('')}" 2>/dev/null || echo "")"

write_hb() { # $1=lastSuccess $2=exitCode $3=failureCategory
  printf '{"workflow":"gmail-sync","cadenceMinutes":720,"lastAttempt":"%s","lastSuccess":"%s","exitCode":%s,"failureCategory":"%s","runId":"%s","model":"%s"}\n' \
    "$ATTEMPT" "$1" "$2" "$3" "$RUN_ID" "${MONITOR_MODEL:-unset}" > "$HB_FILE"
}

# ── Runner seam ──────────────────────────────────────────────────────────
# The monitor is a mid-tier extraction job (see engine/models.json email_monitor);
# it is NOT tied to Claude. To swap runners (e.g. a Hermes cron with Gmail access),
# replace run_monitor with any command that reads the prompt file and writes the
# event file to profiles/amirali/work/events/pending/. Everything else stays.
MONITOR_MODEL="claude-sonnet-4-6"
run_monitor() {
  claude -p "$(cat prompts/gmail-monitor-headless.txt)" \
    --model "$MONITOR_MODEL" \
    --allowedTools "mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,mcp__claude_ai_Gmail__get_message,mcp__claude_ai_Gmail__list_labels,Read,Glob,Grep,Write"
}

echo "=== gmail-sync $RUN_ID (model: $MONITOR_MODEL) ===" >> "$LOG"
run_monitor >> "$LOG" 2>&1
MONITOR_EXIT=$?
if [ $MONITOR_EXIT -ne 0 ]; then
  echo "monitor failed with exit $MONITOR_EXIT" >> "$LOG"
  write_hb "$LAST_SUCCESS" "$MONITOR_EXIT" "monitor_failed"
  exit "$MONITOR_EXIT"
fi

if ! node scripts/import-events.mjs >> "$LOG" 2>&1; then
  write_hb "$LAST_SUCCESS" 1 "import_failed"
  exit 1
fi

write_hb "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 0 ""
echo "gmail-sync $RUN_ID OK" >> "$LOG"
