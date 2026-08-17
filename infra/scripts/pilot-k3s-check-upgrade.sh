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
# update.k3s.io/v1-release/channels/<channel> is NOT a JSON API — verified
# with a raw curl -D-, not assumed: it's a plain HTTP 302 redirect straight
# to the GitHub release tag (e.g. https://github.com/k3s-io/k3s/releases/tag/v1.36.3+k3s1).
# An earlier version of this script guessed a JSON body shape instead
# (from a paraphrased fetch that followed the redirect and summarized the
# resulting GitHub HTML page as if it were the API response) and failed
# silently against the real thing on its first live run. `-o /dev/null -w
# '%{redirect_url}'` reads the Location header directly without following
# it; the version is just the last path segment.
REDIRECT_URL=$(curl -sf -o /dev/null -w '%{redirect_url}' https://update.k3s.io/v1-release/channels/stable || true)
LATEST="${REDIRECT_URL##*/}"

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
