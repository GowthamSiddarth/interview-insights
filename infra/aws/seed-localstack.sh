#!/usr/bin/env bash
# Seeds a LocalStack instance with what api, notification-service (GitHub
# issue #466/D76), and review-analyzer (GitHub issue #340/D81) need for
# their real secrets/IAM path (GitHub issue #78 originally; #466 extended it
# to every remaining api secret plus notification-service's own role;
# #466's own follow-up, D78, added admin-credentials/anthropic-credentials;
# #340/D81 moved anthropic-api-key access from api's role to
# review-analyzer's own, since review-analyzer is now the only service that
# calls the LLM): the secrets each service reads at boot, an IAM role per
# service trusted to be assumed, and each service's own
# *-secrets-access-policy.json attached to its own role. Idempotent — safe
# to re-run against the same LocalStack instance.
#
# Works against either target: the docker-compose `localstack` profile
# (GitHub issue #66) at its default localhost:4566, or the in-cluster
# LocalStack from infra/k8s/overlays/dev (GitHub issue #78, folded out of
# the once-separate `dev-localstack` overlay by #466/D76) once
# port-forwarded, e.g.:
#   kubectl -n interview-insights port-forward svc/localstack 4566:4566
#
# Requires: LocalStack running + reachable at $ENDPOINT.
set -euo pipefail

ENDPOINT="${LOCALSTACK_ENDPOINT:-http://localhost:4566}"
REGION="us-east-1"
ACCOUNT_ID="000000000000"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# database-url matches the in-cluster Postgres Service DNS (infra/k8s/base/
# 03-postgres.yaml) — the same value api used to read from a plaintext
# k8s Secret, just sourced from Secrets Manager instead once GitHub issue
# #79 wired the boot path to actually read it from here. Must embed the
# *actual* Postgres password (GitHub issue #466, D77): since that
# password now comes from the imperatively-provisioned
# `postgres-credentials` Secret, not a fixed committed value, this
# defaults to $POSTGRES_PASSWORD (already required/exported by
# bootstrap-kind.sh, and passed explicitly by cd.yml's "Seed LocalStack
# secrets + IAM" step) rather than a hardcoded "postgres" — getting this
# out of sync with the real Postgres password is exactly the kind of
# footgun D77 was trying to avoid by keeping the two wired together
# instead of two independent places to update by hand. Falls back to the
# literal "postgres" only for the no-real-Postgres-involved LocalStack
# practice flow (README's "Alternative: LocalStack for IAM/Secrets
# Manager practice", GitHub issue #66) where $POSTGRES_PASSWORD is never
# set and this value is never actually dialed.
#
# The password must be percent-encoded before it goes into the connection
# string (GitHub issue #551, found live while verifying #540/D91):
# wiki/deployment-guide.md 5d's own rotation command
# (`openssl rand -base64 24`) can produce `/`, `+`, or `=`, any of which
# breaks postgresql:// URL parsing (Prisma: "P1013: invalid port number
# in database URL") if embedded raw.
urlencode() {
  python3 -c 'import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}
POSTGRES_PASSWORD_URLENCODED="$(urlencode "${POSTGRES_PASSWORD:-postgres}")"
DATABASE_URL_VALUE="${SEED_DATABASE_URL:-postgresql://postgres:${POSTGRES_PASSWORD_URLENCODED}@postgres:5432/interview_insights?schema=public}"
# GitHub issue #803 (Phase 55) — no dev-only placeholder default here
# anymore (CLAUDE.md hard constraint #6: a checked-in value that actually
# functions as a real secret is still a real secret, regardless of how
# obviously placeholder-labeled its text is). Required, not defaulted,
# but unlike ADMIN_PASSWORD_HASH/ADMIN_JWT_SECRET below this never needs
# a human to pick a value — bootstrap-kind.sh and cd.yml's "Provision
# email/candidate secrets" step both generate a real random value
# themselves (once per cluster, reused on later runs) and pass it
# through as SEED_*. See wiki/deployment-guide.md 5e for the one manual
# case (running this script directly, outside either caller).
EMAIL_HASH_SECRET_VALUE="${SEED_EMAIL_HASH_SECRET:?SEED_EMAIL_HASH_SECRET must be set — see wiki/deployment-guide.md section 5e}"
# GitHub issue #466 (D76) — the last two secrets api/notification-service
# still carried as committed plaintext k8s-Secret fallbacks. Must be a
# 32-byte AES-256 key, hex-encoded (64 hex chars) — see docs/DECISIONS.md
# D74. EMAIL_ENCRYPTION_KEY is shared with notification-service (same
# secret ID, read by both services' own IAM roles below) — that service
# can only decrypt what api encrypted under it.
EMAIL_ENCRYPTION_KEY_VALUE="${SEED_EMAIL_ENCRYPTION_KEY:?SEED_EMAIL_ENCRYPTION_KEY must be set — see wiki/deployment-guide.md section 5e}"
CANDIDATE_JWT_SECRET_VALUE="${SEED_CANDIDATE_JWT_SECRET:?SEED_CANDIDATE_JWT_SECRET must be set — see wiki/deployment-guide.md section 5e}"
# GitHub issue #466's own follow-up (D78) — admin-credentials/
# anthropic-credentials still moved into Secrets Manager too, closing
# the "stretch work" #466 explicitly deferred. Unlike every secret
# above, these two have NO dev-only default: ADMIN_PASSWORD_HASH/
# ADMIN_JWT_SECRET never had one on purpose (same reasoning
# bootstrap-kind.sh's own pre-check already gives), so this hard-fails
# rather than silently seeding a placeholder admin credential.
# ANTHROPIC_API_KEY is the one exception allowed to default to empty —
# it's genuinely optional (D78's fetchOptionalSecret).
ADMIN_PASSWORD_HASH_VALUE="${ADMIN_PASSWORD_HASH:?ADMIN_PASSWORD_HASH must be set — see wiki/deployment-guide.md section 5b}"
ADMIN_JWT_SECRET_VALUE="${ADMIN_JWT_SECRET:?ADMIN_JWT_SECRET must be set — see wiki/deployment-guide.md section 5b}"
ANTHROPIC_API_KEY_VALUE="${ANTHROPIC_API_KEY:-}"

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

echo "== Secrets Manager: interview-insights/email-encryption-key =="
awslocal secretsmanager delete-secret --secret-id interview-insights/email-encryption-key \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/email-encryption-key \
  --secret-string "$EMAIL_ENCRYPTION_KEY_VALUE" > /dev/null
echo "OK: created"

echo "== Secrets Manager: interview-insights/candidate-jwt-secret =="
awslocal secretsmanager delete-secret --secret-id interview-insights/candidate-jwt-secret \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/candidate-jwt-secret \
  --secret-string "$CANDIDATE_JWT_SECRET_VALUE" > /dev/null
echo "OK: created"

echo "== Secrets Manager: interview-insights/admin-password-hash =="
awslocal secretsmanager delete-secret --secret-id interview-insights/admin-password-hash \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/admin-password-hash \
  --secret-string "$ADMIN_PASSWORD_HASH_VALUE" > /dev/null
echo "OK: created"

echo "== Secrets Manager: interview-insights/admin-jwt-secret =="
awslocal secretsmanager delete-secret --secret-id interview-insights/admin-jwt-secret \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/admin-jwt-secret \
  --secret-string "$ADMIN_JWT_SECRET_VALUE" > /dev/null
echo "OK: created"

# AWS Secrets Manager's CreateSecret requires SecretString to be at
# least 1 character -- an empty string is rejected outright. Found the
# hard way: seeding "" made this call fail, which under `set -e` aborted
# the rest of this script before it ever reached IAM role provisioning
# below, silently leaving api-secrets-role/notification-service-secrets-
# role unprovisioned. "Not configured" is represented by this secret not
# existing at all instead -- api's own fetchOptionalSecret() (D78)
# already treats a missing secret as "" via ResourceNotFoundException.
if [ -n "$ANTHROPIC_API_KEY_VALUE" ]; then
  echo "== Secrets Manager: interview-insights/anthropic-api-key =="
  awslocal secretsmanager delete-secret --secret-id interview-insights/anthropic-api-key \
    --force-delete-without-recovery > /dev/null 2>&1 || true
  awslocal secretsmanager create-secret --name interview-insights/anthropic-api-key \
    --secret-string "$ANTHROPIC_API_KEY_VALUE" > /dev/null
  echo "OK: created"
else
  echo "== Secrets Manager: interview-insights/anthropic-api-key (skipped, no real key configured) =="
  awslocal secretsmanager delete-secret --secret-id interview-insights/anthropic-api-key \
    --force-delete-without-recovery > /dev/null 2>&1 || true
fi

# Provisions one IAM role + its attached least-privilege policy, given
# role name / policy name / policy JSON path. Called once per service
# (GitHub issue #466 added the second call, for notification-service's
# own role, alongside api's pre-existing one) — each service gets its
# own role/policy pair rather than sharing one, so a compromised or
# over-permissioned service can't read secrets it has no business
# reading (e.g. notification-service can't read email-hash-secret).
provision_role_and_policy() {
  local role_name="$1"
  local policy_name="$2"
  local policy_doc="$3"

  echo "== IAM: $role_name trust policy + $policy_name attachment =="
  # Clean up anything left over from a previous run — a policy can't be
  # deleted while still attached, and create-role fails if the role exists.
  awslocal iam detach-role-policy --role-name "$role_name" \
    --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${policy_name}" > /dev/null 2>&1 || true
  awslocal iam delete-role --role-name "$role_name" > /dev/null 2>&1 || true
  awslocal iam delete-policy --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${policy_name}" > /dev/null 2>&1 || true

  local trust_policy
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
  awslocal iam create-role --role-name "$role_name" \
    --assume-role-policy-document "$trust_policy" > /dev/null
  echo "OK: role created"

  awslocal iam create-policy --policy-name "$policy_name" \
    --policy-document "file://$policy_doc" > /dev/null
  awslocal iam attach-role-policy --role-name "$role_name" \
    --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${policy_name}" > /dev/null
  echo "OK: policy attached"
}

provision_role_and_policy "api-secrets-role" "api-secrets-access-policy" \
  "$SCRIPT_DIR/api-secrets-access-policy.json"
provision_role_and_policy "notification-service-secrets-role" \
  "notification-service-secrets-access-policy" \
  "$SCRIPT_DIR/notification-service-secrets-access-policy.json"
# GitHub issue #340 (Phase 32, D81) — review-analyzer is now the only place
# the LLM is ever called from, so it gets its own role reading database-url
# + anthropic-api-key; api's own role above no longer includes the latter.
provision_role_and_policy "review-analyzer-secrets-role" \
  "review-analyzer-secrets-access-policy" \
  "$SCRIPT_DIR/review-analyzer-secrets-access-policy.json"

echo "== Verifying: each role assumable, its own secrets fetchable via assumed credentials =="
# Proves the AssumeRole -> temporary-credentials -> GetSecretValue chain
# actually works end to end, for both roles. It does NOT prove the policy
# is what's gating access — verify-iam-policy.sh already established that
# LocalStack's free tier doesn't evaluate IAM policies at all (explicit
# allow/deny is not enforced), so this would succeed even against an
# empty or overly-broad policy. Real enforcement only happens against
# real AWS IAM; this stays an honest limitation, not something worked
# around here (see docs/DECISIONS.md D20 and this phase's own decision).
verify_role_can_fetch() {
  local role_name="$1"
  local secret_id="$2"

  local assumed
  assumed=$(awslocal sts assume-role --role-arn "arn:aws:iam::${ACCOUNT_ID}:role/${role_name}" \
    --role-session-name seed-verify)
  local key_id secret_key session_token
  key_id=$(echo "$assumed" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Credentials"]["AccessKeyId"])')
  secret_key=$(echo "$assumed" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Credentials"]["SecretAccessKey"])')
  session_token=$(echo "$assumed" | python3 -c 'import json,sys; print(json.load(sys.stdin)["Credentials"]["SessionToken"])')

  AWS_ACCESS_KEY_ID="$key_id" AWS_SECRET_ACCESS_KEY="$secret_key" \
    AWS_SESSION_TOKEN="$session_token" \
    aws --endpoint-url="$ENDPOINT" --region "$REGION" secretsmanager get-secret-value \
    --secret-id "$secret_id" --query SecretString --output text > /dev/null
  echo "OK: $role_name credentials can fetch $secret_id"
}

verify_role_can_fetch "api-secrets-role" "interview-insights/database-url"
verify_role_can_fetch "notification-service-secrets-role" "interview-insights/email-encryption-key"
verify_role_can_fetch "review-analyzer-secrets-role" "interview-insights/database-url"

echo "== Done =="
