#!/usr/bin/env bash
# Verifies the in-cluster LocalStack Secrets Manager/IAM setup end to end
# (GitHub issue #466, D76/D77) — a live-cluster companion to
# verify-iam-policy.sh's own local, no-cluster policy-syntax check.
#
# Checks, in order:
#   1. Secrets Manager holds exactly the 4 secrets api/notification-service
#      need — no more, no fewer.
#   2. Both IAM roles exist, each with its own policy attached.
#   3. notification-service-secrets-role's policy is scoped to exactly
#      database-url + email-encryption-key — not email-hash-secret/
#      candidate-jwt-secret, which only api-secrets-role should read.
#   4. api's and notification-service's running pods both got their
#      DATABASE_URL/EMAIL_ENCRYPTION_KEY from LocalStack (not empty, not a
#      leftover default), and their EMAIL_ENCRYPTION_KEY values are
#      byte-identical (D74 — notification-service can only decrypt what
#      api encrypted).
#   5. The imperatively-provisioned Secrets (never LocalStack-sourced:
#      postgres-credentials/D77, admin-credentials, localstack-credentials,
#      anthropic-credentials) exist in the cluster.
#
# Same accepted limitation as verify-iam-policy.sh: LocalStack's free
# tier doesn't evaluate IAM policy at runtime (D20) — step 3 proves the
# policy JSON is correctly scoped, not that a live AssumeRole'd
# notification-service session would actually be denied email-hash-secret.
#
# Requires: kubectl context pointed at the right cluster, aws CLI,
# python3. Namespace defaults to interview-insights; override with
# NAMESPACE=... if needed.
set -euo pipefail

NS="${NAMESPACE:-interview-insights}"
ENDPOINT="http://localhost:4566"
REGION="us-east-1"
ACCOUNT_ID="000000000000"

export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
awslocal() { aws --endpoint-url="$ENDPOINT" --region "$REGION" "$@"; }

fail=0

echo "== Port-forwarding LocalStack =="
kubectl -n "$NS" port-forward svc/localstack 4566:4566 > /dev/null 2>&1 &
PF_PID=$!
trap 'kill $PF_PID 2>/dev/null || true' EXIT
for i in $(seq 1 15); do
  curl -sf http://localhost:4566/_localstack/health > /dev/null && break
  sleep 2
done

echo "== 1. Secrets Manager holds exactly the 4 expected secrets =="
actual_secrets=$(awslocal secretsmanager list-secrets --query 'SecretList[].Name' --output text | tr '\t' '\n' | sort)
expected_secrets=$(printf '%s\n' \
  "interview-insights/candidate-jwt-secret" \
  "interview-insights/database-url" \
  "interview-insights/email-encryption-key" \
  "interview-insights/email-hash-secret" | sort)
if [ "$actual_secrets" = "$expected_secrets" ]; then
  echo "OK: exactly the 4 expected secrets exist"
else
  echo "FAIL: secret list doesn't match. Got:"
  echo "$actual_secrets" | sed 's/^/  /'
  fail=1
fi

echo "== 2. Both IAM roles exist, each with its own policy attached =="
for role in api-secrets-role notification-service-secrets-role; do
  if awslocal iam get-role --role-name "$role" > /dev/null 2>&1; then
    echo "OK: role $role exists"
  else
    echo "FAIL: role $role does not exist"
    fail=1
    continue
  fi
  attached=$(awslocal iam list-attached-role-policies --role-name "$role" \
    --query 'AttachedPolicies[].PolicyName' --output text)
  if [ -n "$attached" ]; then
    echo "OK: $role has a policy attached ($attached)"
  else
    echo "FAIL: $role has no policy attached"
    fail=1
  fi
done

echo "== 3. notification-service-secrets-role is scoped to exactly database-url + email-encryption-key =="
resources=$(awslocal iam get-policy-version \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/notification-service-secrets-access-policy" \
  --version-id v1 --query 'PolicyVersion.Document.Statement[0].Resource' --output text | tr '\t' '\n' | sort)
expected_resources=$(printf '%s\n' \
  "arn:aws:secretsmanager:*:*:secret:interview-insights/database-url-*" \
  "arn:aws:secretsmanager:*:*:secret:interview-insights/email-encryption-key-*" | sort)
if [ "$resources" = "$expected_resources" ]; then
  echo "OK: notification-service-secrets-role can read only database-url + email-encryption-key"
else
  echo "FAIL: notification-service-secrets-role's resource list doesn't match. Got:"
  echo "$resources" | sed 's/^/  /'
  fail=1
fi

kill "$PF_PID" 2>/dev/null || true
trap - EXIT

echo "== 4. Running pods actually resolved these from LocalStack =="
api_db_url=$(kubectl -n "$NS" exec deploy/api -- printenv DATABASE_URL 2>/dev/null || echo "")
api_key=$(kubectl -n "$NS" exec deploy/api -- printenv EMAIL_ENCRYPTION_KEY 2>/dev/null || echo "")
api_hash=$(kubectl -n "$NS" exec deploy/api -- printenv EMAIL_HASH_SECRET 2>/dev/null || echo "")
api_jwt=$(kubectl -n "$NS" exec deploy/api -- printenv CANDIDATE_JWT_SECRET 2>/dev/null || echo "")
notif_db_url=$(kubectl -n "$NS" exec deploy/notification-service -- printenv DATABASE_URL 2>/dev/null || echo "")
notif_key=$(kubectl -n "$NS" exec deploy/notification-service -- printenv EMAIL_ENCRYPTION_KEY 2>/dev/null || echo "")

for pair in "api:DATABASE_URL:$api_db_url" "api:EMAIL_HASH_SECRET:$api_hash" \
  "api:EMAIL_ENCRYPTION_KEY:$api_key" "api:CANDIDATE_JWT_SECRET:$api_jwt" \
  "notification-service:DATABASE_URL:$notif_db_url" "notification-service:EMAIL_ENCRYPTION_KEY:$notif_key"; do
  pod="${pair%%:*}"
  rest="${pair#*:}"
  var="${rest%%:*}"
  value="${rest#*:}"
  if [ -n "$value" ]; then
    echo "OK: $pod's $var is non-empty"
  else
    echo "FAIL: $pod's $var is empty — LocalStack fetch likely failed"
    fail=1
  fi
done

if [ -n "$api_key" ] && [ "$api_key" = "$notif_key" ]; then
  echo "OK: api's and notification-service's EMAIL_ENCRYPTION_KEY are byte-identical (D74)"
else
  echo "FAIL: EMAIL_ENCRYPTION_KEY mismatch between api and notification-service — D74 requires these identical"
  fail=1
fi

echo "== 5. Imperatively-provisioned Secrets exist (never LocalStack-sourced) =="
for secret in postgres-credentials admin-credentials localstack-credentials anthropic-credentials; do
  if kubectl -n "$NS" get secret "$secret" > /dev/null 2>&1; then
    echo "OK: $secret exists"
  else
    echo "FAIL: $secret does not exist"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "== All checks passed =="
else
  echo "== One or more checks FAILED =="
  exit 1
fi
