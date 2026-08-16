#!/bin/bash
set -euo pipefail

# GitHub issue #663 (Phase 46) — Postgres backup for the Hetzner pilot.
# Runs ON the pilot VM (installed by the #663 handoff script into
# /usr/local/bin/, invoked nightly via /etc/cron.d/pilot-pg-backup).
#
# `kubectl exec ... pg_dump` needs no credential: it runs inside the
# postgres container over the local unix socket, which the stock
# postgres:16-alpine image trusts by default for local connections (no
# pg_hba.conf override in infra/k8s/base/03-postgres.yaml) — same reason
# the StatefulSet's own readiness/liveness probes (`pg_isready -U
# postgres`) don't need one either.
#
# --clean --if-exists makes the dump self-restoring against a database
# that already has the schema loaded (drops each object before
# recreating it) rather than requiring a pre-emptied database.

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
BACKUP_DIR=/var/backups/postgres
KEEP=7
NAMESPACE=interview-insights
DB=interview_insights

mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/${DB}-${TS}.sql.gz"

POD=$(kubectl -n "$NAMESPACE" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')
kubectl -n "$NAMESPACE" exec "$POD" -- pg_dump -U postgres --clean --if-exists "$DB" | gzip > "$FILE"

# Rotate: keep the newest $KEEP dumps only.
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/"${DB}"-*.sql.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | xargs -r rm --

echo "backup: $FILE ($(du -h "$FILE" | cut -f1))"
