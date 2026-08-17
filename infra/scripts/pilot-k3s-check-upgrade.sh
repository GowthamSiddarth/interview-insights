#!/bin/bash
set -euo pipefail

# GitHub issue #666 (Phase 46) — k3s upgrade/patch cadence for the pilot.
# Runs ON the pilot VM (installed by the #666 handoff script into
# /usr/local/bin/, invoked weekly via /etc/cron.d/pilot-k3s-check-upgrade).
#
# Check-and-log only, deliberately not an auto-upgrade: this is a
# single-node cluster (no rolling/HA upgrade possible), so applying one
# unattended is a real risk to the only replica, not just noise —
# different tradeoff than unattended-upgrades' OS packages (Phase 44
# cloud-init), which restart individual services, not the whole cluster.
# Same "prevent/warn, human decides for the risky part" shape as #667's
# disk-health-check, applied to a binary current/upgrade-available state
# instead of a graduated percentage.
#
# Actually upgrading is infra/scripts/pilot-k3s-upgrade.sh — a separate,
# deliberate, confirmed action.

STATUS_FILE=/var/log/k3s-upgrade-check-status
LOG_TAG=k3s-upgrade-check

CURRENT=$(k3s --version | head -1 | awk '{print $3}')
# curl | sed rather than curl | grep -o | cut: with `pipefail` set, grep -o
# finding no match exits 1 and kills the whole script via `set -e` *before*
# reaching the "couldn't determine latest" guard below — happened for real
# on the first live run, tracing back to the API response having a space
# after the colon (`"latest": "..."`) that the no-space grep pattern
# didn't tolerate. `RAW=... || true` plus a single whitespace-tolerant sed
# means a curl failure or an unexpected response shape both fall through
# to the guard instead of aborting before it.
RAW=$(curl -sf https://update.k3s.io/v1-release/channels/stable || true)
LATEST=$(printf '%s' "$RAW" | sed -n 's/.*"latest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

if [ -z "$LATEST" ]; then
  logger -t "$LOG_TAG" "could not reach/parse update.k3s.io, skipping this check"
  exit 0
fi

if [ "$CURRENT" = "$LATEST" ]; then
  echo "OK $(date -Iseconds) current=$CURRENT" >> "$STATUS_FILE"
  logger -t "$LOG_TAG" "up to date ($CURRENT)"
  echo "up to date ($CURRENT)"
else
  echo "UPGRADE_AVAILABLE $(date -Iseconds) current=$CURRENT latest=$LATEST" >> "$STATUS_FILE"
  logger -t "$LOG_TAG" "upgrade available: $CURRENT -> $LATEST -- run pilot-k3s-upgrade.sh manually to apply"
  echo "upgrade available: $CURRENT -> $LATEST -- run pilot-k3s-upgrade.sh manually to apply"
fi
