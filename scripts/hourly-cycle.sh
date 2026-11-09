#!/usr/bin/env bash
# Runs one full check (sync portal data -> detect anomalies). Called by cron every hour.
# flock makes sure a slow run is never overlapped by the next one.
set -u
cd "$(dirname "$0")/.."
export PATH="/home/cs/.local/bin:/usr/local/bin:/usr/bin:/bin"
LOG="logs/cycle.log"
{
  echo "=== $(date '+%F %T %Z') start ==="
  flock -n /tmp/anomaly-cycle.lock npm -s run worker -- cycle 2>&1 | grep -E '"ok"|"rows"|"error"|newAnomalies|ERROR' \
    || echo "(skipped: previous run still going, or no output)"
  echo "=== end ==="
} >> "$LOG" 2>&1
# keep the log from growing forever (last ~2000 lines)
tail -n 2000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
