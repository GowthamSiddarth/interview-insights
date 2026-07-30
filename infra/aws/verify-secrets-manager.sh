#!/usr/bin/env bash
# Verifies the in-cluster LocalStack Secrets Manager/IAM setup end to end
# (GitHub issue #466, D76/D77/D78) — a live-cluster companion to
# verify-iam-policy.sh's own local, no-cluster policy-syntax check.
#
# Checks, in order:
#   1. Secrets Manager holds exactly the 7 secrets api/notification-service
#      need — no more, no fewer.
#   2. Both IAM roles exist, each with its own policy attached.
#   3. api-secrets-role and notification-service-secrets-role are each
#      scoped to exactly the secrets they should read — api gets all 7,
#      notification-service gets only database-url + email-encryption-key.
#   4. api's and notification-service's pods are Ready with zero restarts
#      and no ResourceNotFoundException in their logs.
#   5. The imperatively-provisioned Secrets (postgres-credentials/D77,
#      admin-credentials, localstack-credentials, anthropic-credentials)
#      exist in the cluster.
#   6. LocalStack's own pod is Ready with zero restarts and its Deployment
#      spec wires admin-credentials/anthropic-credentials in (D78) — the
#      mechanism that lets its init-hook self-heal these two with the
#      *real* value on an unplanned restart, instead of a committed
#      placeholder. A pod that failed to resolve either secretKeyRef
#      would never reach Ready at all (CreateContainerConfigError), so
#      health here is itself proof the wiring resolved correctly.
#
# Why step 4 checks pod health instead of reading the env vars directly:
# `bootstrapSecretsFromLocalStack()` sets `process.env.DATABASE_URL` etc.
# inside the already-running Node process — a real mutation, but one only
# visible to *that* live process. `kubectl exec ... -- printenv` spawns a
# brand-new process inside the container, which gets the environment the
# container was created with (envFrom/etc.), not whatever the long-running
# process later did to its own in-memory process.env; since #466 removed
# these vars from envFrom entirely, printenv predictably shows nothing,
# whether or not the fetch actually succeeded (found the hard way running
# an earlier version of this script against a healthy cluster). The
# bootstrap function has no fallback and throws on any failure -- given
# envFrom no longer provides these values at all, a `Ready` pod with 0
# restarts is only reachable if the LocalStack fetch actually succeeded,
# which is a more reliable signal than trying to peek at a value that
# isn't externally observable this way. Same reasoning covers D74's
# byte-identical EMAIL_ENCRYPTION_KEY requirement across both services --
# not re-checked here at runtime, because step 1 already confirms exactly
# one `email-encryption-key` Secrets Manager entry exists and step 3
# confirms both roles' policies point at that same single entry; two
# services fetching the same Secrets Manager entry get the same value by
# construction, no live comparison needed.
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

echo "== 1. Secrets Manager holds exactly the 7 expected secrets =="
actual_secrets=$(awslocal secretsmanager list-secrets --query 'SecretList[].Name' --output text | tr '\t' '\n' | sort)
expected_secrets=$(printf '%s\n' \
  "interview-insights/candidate-jwt-secret" \
  "interview-insights/database-url" \
  "interview-insights/email-encryption-key" \
  "interview-insights/email-hash-secret" \
  "interview-insights/admin-password-hash" \
  "interview-insights/admin-jwt-secret" \
  "interview-insights/anthropic-api-key" | sort)
if [ "$actual_secrets" = "$expected_secrets" ]; then
  echo "OK: exactly the 7 expected secrets exist"
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

echo "== 3. Each role is scoped to exactly the secrets it should read =="
api_resources=$(awslocal iam get-policy-version \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/api-secrets-access-policy" \
  --version-id v1 --query 'PolicyVersion.Document.Statement[0].Resource' --output text | tr '\t' '\n' | sort)
expected_api_resources=$(printf '%s\n' \
  "arn:aws:secretsmanager:*:*:secret:interview-insights/database-url-*" \
  "arn:aws:secretsmanager:*:*:secret:interview-insights/email-hash-secret-*" \
  "arn:aws:secretsmanager:*:*:secret:interview-insights/email-encryption-key-*" \
  "arn:aws:secretsmanager:*:*:secret:interview-insights/candidate-jwt-secret-*" \
  "arn:aws:secretsmanager:*:*:secret:interview-insights/admin-password-hash-*" \
  "arn:aws:secretsmanager:*:*:secret:interview-insights/admin-jwt-secret-*" \
  "arn:aws:secretsmanager:*:*:secret:interview-insights/anthropic-api-key-*" | sort)
if [ "$api_resources" = "$expected_api_resources" ]; then
  echo "OK: api-secrets-role can read exactly the 7 secrets api needs"
else
  echo "FAIL: api-secrets-role's resource list doesn't match. Got:"
  echo "$api_resources" | sed 's/^/  /'
  fail=1
fi

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

echo "== 4. api/notification-service pods are healthy (the only way to be, post-#466, if the fetch failed) =="
for deploy in api notification-service; do
  ready=$(kubectl -n "$NS" get deployment "$deploy" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  desired=$(kubectl -n "$NS" get deployment "$deploy" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
  if [ -n "$ready" ] && [ "$ready" = "$desired" ]; then
    echo "OK: deployment/$deploy has $ready/$desired replicas Ready"
  else
    echo "FAIL: deployment/$deploy has only ${ready:-0}/$desired replicas Ready"
    fail=1
  fi

  restarts=$(kubectl -n "$NS" get pods -l "app=$deploy" \
    -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}' 2>/dev/null || echo "")
  if [ "$restarts" = "0" ]; then
    echo "OK: $deploy's pod has 0 restarts (no crash-loop from a failed LocalStack fetch)"
  else
    echo "FAIL: $deploy's pod has restarted ($restarts times) — check logs, possibly a failed fetch"
    fail=1
  fi

  if kubectl -n "$NS" logs "deploy/$deploy" --tail=500 2>/dev/null | grep -qi "ResourceNotFoundException"; then
    echo "FAIL: $deploy's logs show ResourceNotFoundException — a secret fetch failed at some point"
    fail=1
  else
    echo "OK: $deploy's logs show no ResourceNotFoundException"
  fi
done

echo "== 5. Imperatively-provisioned Secrets exist (never LocalStack-sourced) =="
for secret in postgres-credentials admin-credentials localstack-credentials anthropic-credentials; do
  if kubectl -n "$NS" get secret "$secret" > /dev/null 2>&1; then
    echo "OK: $secret exists"
  else
    echo "FAIL: $secret does not exist"
    fail=1
  fi
done

echo "== 6. LocalStack's own pod is healthy and wired to self-heal admin/Anthropic secrets (D78) =="
ls_ready=$(kubectl -n "$NS" get deployment localstack -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
ls_desired=$(kubectl -n "$NS" get deployment localstack -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
if [ -n "$ls_ready" ] && [ "$ls_ready" = "$ls_desired" ]; then
  echo "OK: deployment/localstack has $ls_ready/$ls_desired replicas Ready"
else
  echo "FAIL: deployment/localstack has only ${ls_ready:-0}/$ls_desired replicas Ready"
  fail=1
fi

ls_restarts=$(kubectl -n "$NS" get pods -l app=localstack \
  -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}' 2>/dev/null || echo "")
if [ "$ls_restarts" = "0" ]; then
  echo "OK: localstack's pod has 0 restarts"
else
  echo "FAIL: localstack's pod has restarted ($ls_restarts times)"
  fail=1
fi

wired_env=$(kubectl -n "$NS" get deployment localstack \
  -o jsonpath='{.spec.template.spec.containers[0].env[*].name}')
for var in ADMIN_PASSWORD_HASH ADMIN_JWT_SECRET ANTHROPIC_API_KEY; do
  if echo "$wired_env" | grep -qw "$var"; then
    echo "OK: localstack's Deployment wires $var in"
  else
    echo "FAIL: localstack's Deployment does not wire $var in — its init-hook can't self-heal this secret"
    fail=1
  fi
done

if [ "$fail" -eq 0 ]; then
  echo "== All checks passed =="
else
  echo "== One or more checks FAILED =="
  exit 1
fi
