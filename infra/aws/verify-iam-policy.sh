#!/usr/bin/env bash
# Validates api-secrets-access-policy.json (GitHub issue #66, Phase 10) —
# catches a typo'd ARN or an overly broad grant before this is ever
# applied against a real account.
#
# Two-part check, not one: LocalStack's free-tier IAM emulation supports
# policy/role CRUD (create-policy, attach-role-policy, ...) but NOT policy
# *evaluation* — confirmed directly, not assumed:
#   - `iam simulate-custom-policy` returns InternalFailure: "not currently
#     supported by LocalStack"
#   - `iam simulate-principal-policy` runs without erroring, but returns
#     explicitDeny unconditionally regardless of the actual policy
#     content — i.e. it doesn't really evaluate anything
# So: LocalStack proves the JSON is syntactically valid IAM policy
# language (a real create-policy call has to parse and accept it — this
# catches the kind of structural typo real IAM would also reject); a
# plain structural check below proves the *semantic* properties (exactly
# one read-only action, no overly-broad resource) that policy simulation
# would otherwise be the natural tool for.
#
# Requires: LocalStack running (`docker compose --profile localstack up`)
# and LOCALSTACK_AUTH_TOKEN set (see README.md).
set -euo pipefail

ENDPOINT="http://localhost:4566"
REGION="us-east-1"
POLICY_NAME="api-secrets-access-policy"
POLICY_DOC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/api-secrets-access-policy.json"

export AWS_ACCESS_KEY_ID=test
export AWS_SECRET_ACCESS_KEY=test
awslocal() { aws --endpoint-url="$ENDPOINT" --region "$REGION" "$@"; }

fail=0

echo "== Part 1: LocalStack IAM accepts the policy as valid syntax =="
# Clean up anything left over from a previous run of this script — a
# policy can't be deleted while still attached to a role.
for role in $(awslocal iam list-entities-for-policy \
  --policy-arn "arn:aws:iam::000000000000:policy/${POLICY_NAME}" \
  --query 'PolicyRoles[].RoleName' --output text 2>/dev/null || true); do
  awslocal iam detach-role-policy --role-name "$role" \
    --policy-arn "arn:aws:iam::000000000000:policy/${POLICY_NAME}" > /dev/null 2>&1 || true
done
awslocal iam delete-policy --policy-arn "arn:aws:iam::000000000000:policy/${POLICY_NAME}" > /dev/null 2>&1 || true

if awslocal iam create-policy --policy-name "$POLICY_NAME" \
  --policy-document "file://$POLICY_DOC" > /dev/null 2>&1; then
  echo "OK: LocalStack IAM accepted the policy document"
else
  echo "FAIL: LocalStack IAM rejected the policy document as invalid"
  fail=1
fi

echo "== Part 2: structural checks (policy evaluation isn't reliably emulated) =="

action=$(python3 -c "import json; print(json.load(open('$POLICY_DOC'))['Statement'][0]['Action'])")
if [ "$action" = "secretsmanager:GetSecretValue" ]; then
  echo "OK: grants exactly one read-only action ($action)"
else
  echo "FAIL: expected exactly 'secretsmanager:GetSecretValue', got: $action"
  fail=1
fi

resources=$(python3 -c "import json; print('\n'.join(json.load(open('$POLICY_DOC'))['Statement'][0]['Resource']))")
while IFS= read -r resource; do
  case "$resource" in
    "arn:aws:secretsmanager:*:*:secret:interview-insights/"*"-*")
      echo "OK: resource scoped to a named secret under interview-insights/: $resource" ;;
    *)
      echo "FAIL: resource is not scoped to a specific named secret: $resource"
      fail=1 ;;
  esac
done <<< "$resources"

if echo "$resources" | grep -qx '\*'; then
  echo "FAIL: a bare '*' resource would grant access to every secret in the account"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "== All checks passed =="
else
  echo "== One or more checks FAILED =="
  exit 1
fi
