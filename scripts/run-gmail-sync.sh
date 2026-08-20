#!/usr/bin/env bash
# Gmail sync wrapper (HLT-2): IMAP snapshot -> OpenAI monitor -> import -> render.
# Scheduled by a LaunchAgent (07:00 + 19:00, user-approved token cost). Machine
# specifics live OUTSIDE this script: the LaunchAgent/environment must provide a
# PATH containing node, himalaya, and the Hermes CLI; the log path is overridable via
# RESUME_OS_SYNC_LOG. The ONLY model call is the monitor itself; heartbeat +
# import + render are deterministic.
# -e: initialization must fail closed — a broken cd, node, or mkdir must abort,
# never continue with an empty WORK. Command exits we want to inspect (the
# monitor, the import) are captured through if-blocks, which -e permits.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${RESUME_OS_SYNC_LOG:-$HOME/Library/Logs/resume-os-gmail-sync.log}"
cd "$REPO"

# Resolve the active profile's work dir through engine config (never hardcode a profile).
WORK="$(node --input-type=module -e "import { workDir } from './engine/config.mjs'; console.log(workDir());")"
if [ -z "$WORK" ] || [ ! -d "$WORK" ]; then
  echo "FATAL: could not resolve work dir (got: '$WORK')" >&2
  exit 1
fi
HB_DIR="$WORK/heartbeats"
HB_FILE="$HB_DIR/gmail-sync.json"
PENDING_DIR="$WORK/events/pending"
SNAPSHOT_DIR="$WORK/runtime/gmail-sync"
mkdir -p "$HB_DIR" "$PENDING_DIR" "$SNAPSHOT_DIR"
SNAPSHOT_MAX_AGE_MINUTES="${GMAIL_SNAPSHOT_MAX_AGE_MINUTES:-1440}"
if ! [[ "$SNAPSHOT_MAX_AGE_MINUTES" =~ ^[1-9][0-9]*$ ]]; then
  echo "FATAL: GMAIL_SNAPSHOT_MAX_AGE_MINUTES must be a positive integer" >&2
  exit 1
fi
# The directory is dedicated to Gmail runtime snapshots and was resolved under
# the active profile work directory above. Delete only stale JSON children.
find "$SNAPSHOT_DIR" -type f -name '*.json' -mmin "+$SNAPSHOT_MAX_AGE_MINUTES" -delete
RUN_ID="$(date +%Y%m%d-%H%M%S)"
ATTEMPT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LAST_SUCCESS="$(node -e "try{console.log(require('$HB_FILE').lastSuccess||'')}catch{console.log('')}" 2>/dev/null || echo "")"
SNAPSHOT="$SNAPSHOT_DIR/$RUN_ID.json"
cleanup_snapshot() {
  rm -f -- "$SNAPSHOT"
}
trap cleanup_snapshot EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

write_hb() { # $1=lastSuccess $2=exitCode $3=failureCategory
  printf '{"workflow":"gmail-sync","cadenceMinutes":720,"lastAttempt":"%s","lastSuccess":"%s","exitCode":%s,"failureCategory":"%s","runId":"%s","model":"%s"}\n' \
    "$ATTEMPT" "$1" "$2" "$3" "$RUN_ID" "${MONITOR_MODEL:-unset}" > "$HB_FILE"
}

# ── Runner seam ──────────────────────────────────────────────────────────
# The monitor is a mid-tier extraction job (see engine/models.json email_monitor).
# Himalaya is the one active mailbox reader. It produces a short-lived, read-only
# local snapshot; Hermes/OpenAI classifies it and writes an event handoff file.
# The importer below remains deterministic and is the only tracker writer.
#
# The wrapper is the single authority on profile resolution: it substitutes the
# resolved work dir into the prompt's <WORK_DIR> placeholder so the agent never
# re-resolves the profile (and cannot desync from RESUME_OS_PROFILE).
PROMPT="$(cat prompts/gmail-monitor-headless.txt)"
PROMPT="${PROMPT//<WORK_DIR>/$WORK}"
PROMPT="${PROMPT//<GMAIL_SNAPSHOT_PATH>/$SNAPSHOT}"
MONITOR_MODEL="${GMAIL_OPENAI_MODEL:-gpt-5.6-terra}"
run_monitor() {
  hermes chat -q "$PROMPT" \
    --model "$MONITOR_MODEL" \
    -Q \
    -t file \
    --max-turns 30 \
    --ignore-rules
}

echo "=== gmail-sync $RUN_ID (model: $MONITOR_MODEL) ===" >> "$LOG"

# Output contract: every monitor run MUST write one new event file (the prompt
# requires a NO_JOB_EMAIL_EVENTS file even on quiet days). Snapshot pending/
# before the run so exit 0 without an artifact is recorded as a failure, not a
# silent "success".
PENDING_BEFORE="$(ls -1 "$PENDING_DIR" 2>/dev/null | sort)"

# Three overlapping days makes retries safe; importer deduplication keys each
# imported event by source_message_id. The snapshot is removed on every exit.
SEARCHED_AFTER="$(node -e 'const d=new Date(); d.setDate(d.getDate()-3); console.log(d.toISOString().slice(0,10))')"
if ! node scripts/fetch-gmail-events.mjs --output "$SNAPSHOT" --after "$SEARCHED_AFTER" >> "$LOG" 2>&1; then
  echo "IMAP snapshot failed" >> "$LOG"
  write_hb "$LAST_SUCCESS" 1 "mailbox_read_failed"
  exit 1
fi

if run_monitor >> "$LOG" 2>&1; then
  MONITOR_EXIT=0
else
  MONITOR_EXIT=$?
fi
if [ $MONITOR_EXIT -ne 0 ]; then
  echo "monitor failed with exit $MONITOR_EXIT" >> "$LOG"
  write_hb "$LAST_SUCCESS" "$MONITOR_EXIT" "monitor_failed"
  exit "$MONITOR_EXIT"
fi

PENDING_AFTER="$(ls -1 "$PENDING_DIR" 2>/dev/null | sort)"
NEW_FILES="$(comm -13 <(printf '%s\n' "$PENDING_BEFORE") <(printf '%s\n' "$PENDING_AFTER") | grep -c . || true)"
if [ "$NEW_FILES" -eq 0 ]; then
  echo "monitor exited 0 but wrote no event file (output contract violated)" >> "$LOG"
  write_hb "$LAST_SUCCESS" 1 "monitor_output_missing"
  exit 1
fi

if ! node scripts/import-events.mjs >> "$LOG" 2>&1; then
  write_hb "$LAST_SUCCESS" 1 "import_failed"
  exit 1
fi

write_hb "$(date -u +%Y-%m-%dT%H:%M:%SZ)" 0 ""
echo "gmail-sync $RUN_ID OK" >> "$LOG"
