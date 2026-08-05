#!/bin/bash
set -euo pipefail

# Proactive disk-pressure monitoring for the self-hosted macOS CD runner
# (GitHub issue #532). Three separate incidents (D35/#215, D43/#240,
# #530) all trace back to the same root cause — build cache and dangling
# images accumulating on this persistent runner's disk until an
# OpenSearch flood-stage watermark trips mid-deploy — every one
# discovered only when a CD run already failed. This runs the same
# prune commands cd.yml's own post-deploy step uses, but proactively on
# a daily schedule via macOS launchd (same mechanism as
# infra/scripts/dev-port-forwards.sh, GitHub issue #312), so pressure is
# caught and cleared between deploys instead of during one.
#
# Two thresholds, deliberately below cd.yml's own pre-flight gate (issue
# #531, fails a deploy at 85%) so this job clears pressure before that
# gate is ever hit:
#   - HARD (auto-prune trigger): disk usage at/above this runs the same
#     prune commands cd.yml's "Prune stale Docker artifacts"/"Prune
#     orphaned kind-node images" steps run.
#   - WARN (notify): checked *after* pruning — if usage is still at/above
#     this, auto-prune alone didn't clear it, so a local notification
#     fires (there's time to investigate before the next CD run, not an
#     already-failed deploy).
#
# Disk only for v1 (scope note in GitHub issue #532) — memory/CPU
# trend-watching is a natural follow-up, not this job's job yet.
#
# Usage:
#   infra/scripts/disk-health-check.sh install    # idempotent — safe to re-run
#   infra/scripts/disk-health-check.sh uninstall
#   infra/scripts/disk-health-check.sh status
#   infra/scripts/disk-health-check.sh run        # what launchd calls daily; also safe to run by hand
#
# Logs: /tmp/interview-insights-disk-health/health-check.log

HARD_THRESHOLD=70
WARN_THRESHOLD=80
CLUSTER_NAME="interview-insights"
LABEL="local.interview-insights.disk-health-check"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="/tmp/interview-insights-disk-health"
UID_DOMAIN="gui/$(id -u)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

plist_path() { echo "${LAUNCH_AGENTS_DIR}/${LABEL}.plist"; }

disk_pct() {
  df -P / | awk 'NR==2 { gsub("%", "", $5); print $5 }'
}

write_plist() {
  mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"
  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0">'
    echo '<dict>'
    echo "  <key>Label</key><string>${LABEL}</string>"
    echo '  <key>ProgramArguments</key>'
    echo '  <array>'
    echo "    <string>${SCRIPT_PATH}</string>"
    echo '    <string>run</string>'
    echo '  </array>'
    echo '  <key>StartCalendarInterval</key>'
    echo '  <dict>'
    echo '    <key>Hour</key><integer>8</integer>'
    echo '    <key>Minute</key><integer>0</integer>'
    echo '  </dict>'
    echo "  <key>StandardOutPath</key><string>${LOG_DIR}/health-check.log</string>"
    echo "  <key>StandardErrorPath</key><string>${LOG_DIR}/health-check.log</string>"
    echo '</dict>'
    echo '</plist>'
  } > "$(plist_path)"
}

install_job() {
  write_plist
  # bootout is a no-op (ignored via ||true) if it wasn't already loaded —
  # bootstrap always starting from a clean slate keeps this idempotent,
  # same pattern as dev-port-forwards.sh.
  launchctl bootout "${UID_DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
  launchctl bootstrap "$UID_DOMAIN" "$(plist_path)"
  echo "installed: runs daily at 08:00 -> ${LABEL}"
  echo "logs: ${LOG_DIR}/health-check.log"
  echo "run it once now to verify: $0 run"
}

uninstall_job() {
  launchctl bootout "${UID_DOMAIN}/${LABEL}" >/dev/null 2>&1 || true
  rm -f "$(plist_path)"
  echo "uninstalled: ${LABEL}"
}

status_job() {
  if launchctl print "${UID_DOMAIN}/${LABEL}" >/dev/null 2>&1; then
    echo "${LABEL}: installed"
  else
    echo "${LABEL}: NOT installed"
  fi
}

run_check() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) disk health check starting"

  local pct
  pct="$(disk_pct)"
  echo "host disk usage: ${pct}%"
  docker system df 2>/dev/null || echo "docker system df unavailable"

  # Best-effort — the OpenSearch port-forward (infra/scripts/dev-port-
  # forwards.sh) may not be running when this fires unattended; that's
  # not itself a failure of this job.
  curl -sf "http://localhost:9200/_cat/allocation?v" 2>/dev/null \
    || echo "OpenSearch not reachable on localhost:9200 (port-forward not running?) - skipping"

  if [ "$pct" -ge "$HARD_THRESHOLD" ]; then
    echo "disk usage ${pct}% >= hard threshold ${HARD_THRESHOLD}% -- auto-pruning (same commands cd.yml's own prune steps run)"
    docker image prune -f
    docker builder prune -f --filter until=6h
    "$REPO_ROOT/infra/scripts/prune-kind-node-images.sh" "$CLUSTER_NAME" || echo "prune-kind-node-images.sh failed or cluster not running -- continuing"
    pct="$(disk_pct)"
    echo "post-prune disk usage: ${pct}%"
  else
    echo "disk usage ${pct}% below hard threshold ${HARD_THRESHOLD}% -- no action needed"
  fi

  if [ "$pct" -ge "$WARN_THRESHOLD" ]; then
    local msg="Disk at ${pct}% after auto-prune -- investigate before next CD run (wiki/deployment-guide.md section 11.4)."
    echo "WARN: ${msg}"
    osascript -e "display notification \"${msg}\" with title \"interview-insights CD runner disk\"" 2>/dev/null || true
  fi

  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) disk health check done"
}

case "${1:-}" in
  install) install_job ;;
  uninstall) uninstall_job ;;
  status) status_job ;;
  run) run_check ;;
  *)
    echo "Usage: $0 {install|uninstall|status|run}" >&2
    exit 1
    ;;
esac
