#!/usr/bin/env bash
# Seeds a LocalStack instance with what api needs for Phase 11's real
# secrets/IAM path (GitHub issue #78): the two secrets it reads at boot,
# an IAM role trusted to be assumed, and the existing
# api-secrets-access-policy.json attached to that role. Idempotent —
# safe to re-run against the same LocalStack instance.
#
# Works against either target: the docker-compose `localstack` profile
# (GitHub issue #66) at its default localhost:4566, or the in-cluster
# LocalStack from infra/k8s/overlays/dev-localstack (GitHub issue #78)
# once port-forwarded, e.g.:
#   kubectl -n interview-insights port-forward svc/localstack 4566:4566
#
# Requires: LocalStack running + reachable at $ENDPOINT.
set -euo pipefail

ENDPOINT="${LOCALSTACK_ENDPOINT:-http://localhost:4566}"
REGION="us-east-1"
ACCOUNT_ID="000000000000"
ROLE_NAME="api-secrets-role"
POLICY_NAME="api-secrets-access-policy"
POLICY_DOC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/api-secrets-access-policy.json"

# database-url matches the in-cluster Postgres Service DNS (infra/k8s/base/
# 03-postgres.yaml) — the same value infra/k8s/base/01-postgres-secret.yaml
# hands api today, just sourced from Secrets Manager instead once GitHub
# issue #79 wires the boot path to actually read it from here.
DATABASE_URL_VALUE="${SEED_DATABASE_URL:-postgresql://postgres:postgres@postgres:5432/interview_insights?schema=public}"
EMAIL_HASH_SECRET_VALUE="${SEED_EMAIL_HASH_SECRET:-localstack-seeded-secret-change-me}"

export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
awslocal() { aws --endpoint-url="$ENDPOINT" --region "$REGION" "$@"; }

echo "== Secrets Manager: interview-insights/database-url =="
awslocal secretsmanager delete-secret --secret-id interview-insights/database-url \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/database-url \
  --secret-string "$DATABASE_URL_VALUE" > /dev/null
echo "OK: created"

echo "== Secrets Manager: interview-insights/email-hash-secret =="
awslocal secretsmanager delete-secret --secret-id interview-insights/email-hash-secret \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/email-hash-secret \
  --secret-string "$EMAIL_HASH_SECRET_VALUE" > /dev/null
echo "OK: created"

echo "== IAM: $ROLE_NAME trust policy + $POLICY_NAME attachment =="
# Clean up anything left over from a previous run — a policy can't be
# deleted while still attached, and create-role fails if the role exists.
awslocal iam detach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}" > /dev/null 2>&1 || true
awslocal iam delete-role --role-name "$ROLE_NAME" > /dev/null 2>&1 || true
awslocal iam delete-policy --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}" > /dev/null 2>&1 || true

trust_policy=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::${ACCOUNT_ID}:root" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
)
awslocal iam create-role --role-name "$ROLE_NAME" \
  --assume-role-policy-document "$trust_policy" > /dev/null
echo "OK: role created"

awslocal iam create-policy --policy-name "$POLICY_NAME" \
  --policy-document "file://$POLICY_DOC" > /dev/null
awslocal iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}" > /dev/null
echo "OK: policy attached"

echo "== Verifying: role assumable, secrets fetchable via assumed credentials =="
# Proves the AssumeRole -> temporary-credentials -> GetSecretValue chain
# actually works end to end. It does NOT prove the policy is what's
# gating access — verify-iam-policy.sh already established that
# LocalStack's free tier doesn't evaluate IAM policies at all (explicit
# allow/deny is not enforced), so this would succeed even against an
# empty or overly-broad policy. Real enforcement only happens against
# real AWS IAM; this stays an honest limitation, not something worked
# around here (see docs/DECISIONS.md D20 and this phase's own decision).
assumed=$(awslocal sts assume-role --role-arn "arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}" \
  --role-session-name seed-verify)
export AWS_ACCESS_KEY_ID2=$(echo "$assumed" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Credentials"]["AccessKeyId"])')
export AWS_SECRET_ACCESS_KEY2=$(echo "$assumed" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Credentials"]["SecretAccessKey"])')
export AWS_SESSION_TOKEN2=$(echo "$assumed" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Credentials"]["SessionToken"])')

AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID2" AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY2" \
  AWS_SESSION_TOKEN="$AWS_SESSION_TOKEN2" \
  aws --endpoint-url="$ENDPOINT" --region "$REGION" secretsmanager get-secret-value \
  --secret-id interview-insights/database-url --query SecretString --output text > /dev/null
echo "OK: assumed-role credentials can fetch database-url"

echo "== Done =="
