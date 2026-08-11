#!/usr/bin/env bash
# Self-service admin credential rotation for the moderation admin login
# (GitHub issue #192, Phase 18; sourcing via LocalStack Secrets Manager
# per D78, GitHub issue #466's follow-up) — consolidates the manual
# multi-step "one-time setup"/"to rotate again later" commands from
# wiki/deployment-guide.md section 5b into one script, for whenever the
# deployed kind cluster's admin password is lost or needs replacing.
# Deliberately not a UI/API "forgot password" flow: ADMIN_PASSWORD_HASH/
# ADMIN_JWT_SECRET are provisioned imperatively and never touch a
# database migration or committed manifest (hard constraint #6), so
# rotation stays an out-of-band operator action, same as every other
# imperatively-provisioned secret this project has.
#
# What it does: generates a fresh password + JWT secret, updates the
# ADMIN_PASSWORD_HASH/ADMIN_JWT_SECRET GitHub repo secrets, upserts the
# admin-credentials k8s Secret, re-seeds LocalStack Secrets Manager from
# it, and restarts api to pick up the new value. Prints the new plaintext
# password exactly once at the end — it is never written to disk or
# logged anywhere by this script; save it (a password manager entry) the
# moment it prints, same as wiki/deployment-guide.md section 5b already
# instructs. Idempotent to re-run: every step here is either a fresh
# generation or an upsert, never a create-only call.
#
# Requires: openssl, node (with api/node_modules installed — reuses
# api's own bcryptjs, doesn't add a dependency anywhere for this), gh
# (authenticated), kubectl (pointed at the interview-insights kind
# context). Does NOT touch native local dev's api/.env — that's a
# separate, untracked file; update it by hand afterward if you also want
# native local dev to use the new password.
set -euo pipefail

NAMESPACE="interview-insights"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

for bin in openssl node gh kubectl; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERROR: $bin not found on PATH." >&2; exit 1; }
done

CURRENT_CONTEXT="$(kubectl config current-context 2>/dev/null || true)"
if [[ "$CURRENT_CONTEXT" != *"$NAMESPACE"* && "$CURRENT_CONTEXT" != *"kind"* ]]; then
  echo "WARNING: current kubectl context is '$CURRENT_CONTEXT', which doesn't" >&2
  echo "obviously look like the local kind cluster. Ctrl-C now if that's wrong." >&2
fi

echo "This will invalidate the CURRENT admin password immediately once applied."
read -r -p "Continue rotating admin-credentials in '$NAMESPACE'? [y/N] " CONFIRM
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
  echo "Aborted, nothing changed."
  exit 0
fi

echo "== 1. Generate a fresh password, JWT secret, and bcrypt hash =="
NEW_PASSWORD="$(openssl rand -base64 24)"
NEW_JWT_SECRET="$(openssl rand -hex 32)"
NEW_HASH="$(cd "$REPO_ROOT/api" && node -e "require('bcryptjs').hash(process.argv[1], 10).then((h) => process.stdout.write(h))" "$NEW_PASSWORD")"

echo "== 2. Update GitHub repo secrets (so the next CD run stays in sync) =="
printf '%s' "$NEW_HASH" | gh secret set ADMIN_PASSWORD_HASH --repo GowthamSiddarth/interview-insights
printf '%s' "$NEW_JWT_SECRET" | gh secret set ADMIN_JWT_SECRET --repo GowthamSiddarth/interview-insights

echo "== 3. Upsert the admin-credentials k8s Secret =="
kubectl create secret generic admin-credentials \
  --namespace "$NAMESPACE" \
  --from-literal=ADMIN_PASSWORD_HASH="$NEW_HASH" \
  --from-literal=ADMIN_JWT_SECRET="$NEW_JWT_SECRET" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "== 4. Re-seed LocalStack Secrets Manager from the new values =="
kubectl -n "$NAMESPACE" port-forward svc/localstack 4566:4566 &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT
for i in $(seq 1 15); do
  curl -sf http://localhost:4566/_localstack/health > /dev/null && break
  sleep 2
done
ADMIN_PASSWORD_HASH="$NEW_HASH" ADMIN_JWT_SECRET="$NEW_JWT_SECRET" "$REPO_ROOT/infra/aws/seed-localstack.sh"
kill $PF_PID 2>/dev/null || true
trap - EXIT

echo "== 5. Restart api to fetch the new value =="
kubectl -n "$NAMESPACE" rollout restart deployment/api
kubectl -n "$NAMESPACE" rollout status deployment/api --timeout=90s

echo ""
echo "== Done. New admin login (save this now — it will not be shown again): =="
echo "  Username: admin"
echo "  Password: $NEW_PASSWORD"
echo ""
echo "Native local dev (api/.env) is untouched by this script — update it"
echo "by hand if you also want native local dev to use this password."
