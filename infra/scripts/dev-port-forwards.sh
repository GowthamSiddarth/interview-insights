#!/bin/bash
set -euo pipefail

# Wires the local-dev port-forwards (Postgres, OpenSearch, Mailpit,
# Redpanda) into macOS launchd LaunchAgents instead of plain backgrounded
# shell jobs.
#
# Why: `kubectl port-forward ... & disown` only survives as long as the
# shell process that started it stays alive. In an AI-assisted dev
# session, each tool invocation can run in a fresh shell — a background
# job started in one invocation reliably dies the moment that shell gets
# torn down, which happened repeatedly during Phase 28's live
# verification (every one of Postgres/OpenSearch/Mailpit's forwards, not
# just one). launchd is the OS-native mechanism for a process that needs
# to outlive any particular shell/terminal: once bootstrapped into the
# user's GUI domain, it's supervised independently, with KeepAlive
# restarting it if the underlying `kubectl port-forward` ever exits (e.g.
# a pod restart breaking the tunnel).
#
# Usage:
#   infra/scripts/dev-port-forwards.sh start    # idempotent — safe to re-run
#   infra/scripts/dev-port-forwards.sh stop
#   infra/scripts/dev-port-forwards.sh restart
#   infra/scripts/dev-port-forwards.sh status
#
# Logs: /tmp/interview-insights-port-forwards/<service>.log

NAMESPACE="interview-insights"
LABEL_PREFIX="local.interview-insights.portforward"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="/tmp/interview-insights-port-forwards"
UID_DOMAIN="gui/$(id -u)"

KUBECTL_PATH="$(command -v kubectl)"

# macOS ships bash 3.2 (no associative arrays) — a case statement instead
# of `declare -A` keeps this portable without requiring Homebrew bash.
SERVICES=(postgres opensearch mailpit redpanda)
ports_for() {
  case "$1" in
    postgres) echo "5432:5432" ;;
    opensearch) echo "9200:9200" ;;
    mailpit) echo "1025:1025 8025:8025" ;;
    # redpanda's Service exposes this as a second port (`kafka-external`,
    # infra/k8s/base/09-redpanda.yaml) specifically for this — the
    # broker's own `--advertise-kafka-addr` already tells clients its
    # external listener is "localhost:19092", the same address
    # docker-compose's own redpanda service exposes directly, and what
    # every REDPANDA_BROKERS default in this codebase already points at.
    redpanda) echo "19092:19092" ;;
  esac
}

label() { echo "${LABEL_PREFIX}.$1"; }
plist_path() { echo "${LAUNCH_AGENTS_DIR}/$(label "$1").plist"; }

write_plist() {
  local name="$1"
  local plist
  plist="$(plist_path "$name")"
  mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

  {
    echo '<?xml version="1.0" encoding="UTF-8"?>'
    echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    echo '<plist version="1.0">'
    echo '<dict>'
    echo "  <key>Label</key><string>$(label "$name")</string>"
    echo '  <key>ProgramArguments</key>'
    echo '  <array>'
    echo "    <string>${KUBECTL_PATH}</string>"
    echo '    <string>port-forward</string>'
    echo '    <string>-n</string>'
    echo "    <string>${NAMESPACE}</string>"
    echo "    <string>svc/${name}</string>"
    for p in $(ports_for "$name"); do
      echo "    <string>${p}</string>"
    done
    echo '  </array>'
    echo '  <key>RunAtLoad</key><true/>'
    echo '  <key>KeepAlive</key><true/>'
    echo "  <key>StandardOutPath</key><string>${LOG_DIR}/${name}.log</string>"
    echo "  <key>StandardErrorPath</key><string>${LOG_DIR}/${name}.log</string>"
    echo '</dict>'
    echo '</plist>'
  } > "$plist"
}

start_all() {
  for name in "${SERVICES[@]}"; do
    write_plist "$name"
    # bootout is a no-op (ignored via ||true) if it wasn't already loaded —
    # bootstrap always starting from a clean slate keeps this idempotent.
    launchctl bootout "${UID_DOMAIN}/$(label "$name")" >/dev/null 2>&1 || true
    launchctl bootstrap "$UID_DOMAIN" "$(plist_path "$name")"
    echo "started: $name -> $(label "$name")"
  done
}

stop_all() {
  for name in "${SERVICES[@]}"; do
    launchctl bootout "${UID_DOMAIN}/$(label "$name")" >/dev/null 2>&1 || true
    rm -f "$(plist_path "$name")"
    echo "stopped: $name"
  done
}

status_all() {
  for name in "${SERVICES[@]}"; do
    if launchctl print "${UID_DOMAIN}/$(label "$name")" >/dev/null 2>&1; then
      echo "$name: running"
    else
      echo "$name: NOT running"
    fi
  done
}

case "${1:-}" in
  start) start_all ;;
  stop) stop_all ;;
  restart) stop_all; sleep 1; start_all ;;
  status) status_all ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 1
    ;;
esac
