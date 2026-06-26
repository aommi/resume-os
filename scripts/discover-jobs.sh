#!/usr/bin/env bash
# discover-jobs.sh — search LinkedIn and output NDJSON of results.
# The cron agent processes new jobs into inbox/<job-id>/metadata.json, then
# regenerates jobs-tracker.md with scripts/job-board.mjs.
#
# Usage:
#   ./scripts/discover-jobs.sh
#
# Output: newline-delimited JSON to stdout. One object per job.
# Stderr: status messages.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEARCH_SCRIPT="$SCRIPT_DIR/search-linkedin-jobs.mjs"

if [ ! -f "$SEARCH_SCRIPT" ]; then
  echo "ERROR: search script not found: $SEARCH_SCRIPT" >&2
  exit 1
fi

echo "=== Job Discovery $(date -u +"%Y-%m-%d %H:%M UTC") ===" >&2
echo "" >&2

# Run search, output NDJSON to stdout, stderr passthrough
node "$SEARCH_SCRIPT" 2>&2

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "" >&2
  echo "Search exited with code $EXIT_CODE. If this is a login issue, run:" >&2
  echo "  node $SCRIPT_DIR/save-linkedin-cookies.mjs" >&2
  exit $EXIT_CODE
fi
