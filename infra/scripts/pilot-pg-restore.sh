#!/bin/bash
set -euo pipefail

# GitHub issue #663 (Phase 46) — restore counterpart to pilot-pg-backup.sh.
# Runs ON the pilot VM: infra/scripts/pilot-pg-restore.sh /var/backups/postgres/<file>.sql.gz
#
# The backup was taken with --clean --if-exists, so this restores cleanly
# against the database as it currently stands — no separate "drop the
# database first" step needed.

if [ $# -ne 1 ]; then
  echo "Usage: $0 <path-to-dump.sql.gz>" >&2
  echo "List available dumps: ls -lh /var/backups/postgres/" >&2
  exit 1
fi

DUMP_FILE="$1"
if [ ! -f "$DUMP_FILE" ]; then
  echo "No such file: $DUMP_FILE" >&2
  exit 1
fi

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
NAMESPACE=interview-insights
DB=interview_insights

POD=$(kubectl -n "$NAMESPACE" get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')

echo "Restoring $DUMP_FILE into pod $POD, database $DB..."
read -r -p "This overwrites current data in $DB. Continue? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Aborted."
  exit 1
fi

gunzip -c "$DUMP_FILE" | kubectl -n "$NAMESPACE" exec -i "$POD" -- psql -U postgres -v ON_ERROR_STOP=1 "$DB"
echo "Restore complete."
