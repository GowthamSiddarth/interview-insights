#!/usr/bin/env bash
# LocalStack init-hook (https://docs.localstack.cloud/user-guide/lifecycle-hooks/):
# any script under /etc/localstack/init/ready.d/ runs automatically every
# time LocalStack finishes starting -- including after an *unplanned*
# restart, not just a deliberate `kubectl apply`/CD run. LocalStack's
# Deployment (../08-localstack.yaml) deliberately has no PVC (issue #78 --
# "not a source of truth"), so an unplanned restart wipes its Secrets
# Manager/IAM state; without this hook, `api`/`notification-service`
# crash-loop until a human notices and reruns infra/aws/seed-localstack.sh
# by hand (the gotcha documented in wiki/deployment-guide.md section 3).
# This makes that recovery automatic instead.
#
# Deliberately NOT the same script as infra/aws/seed-localstack.sh: that
# one runs *outside* the container (CD, bootstrap-kind.sh, a human) and
# needs an explicit --endpoint-url/region/fake credentials; this one runs
# *inside* the LocalStack container itself, where the bundled `awslocal`
# wrapper needs none of that, and doesn't need the human-facing
# assumed-role verification step. If the secret names/values, role names,
# policy names, or either service's own *-secrets-access-policy.json
# contents ever change, keep both in sync -- coupled by convention, not
# shared code, same as this project's overlay pairs already are. GitHub
# issue #466 (D76) extended this to every remaining api secret plus
# notification-service's own role -- this file's own out-of-sync-ness
# after that PR merged is exactly the risk this comment is warning
# about. #466's own follow-up (D78) added admin-credentials/
# anthropic-credentials on top -- same warning applies.
#
# POSTGRES_PASSWORD isn't available inside this container the way it is
# for infra/aws/seed-localstack.sh's own DATABASE_URL_VALUE (GitHub issue
# #466, D77) -- LocalStack's own pod has no reason to receive Postgres's
# credential. This seeded value intentionally matches only the
# password Postgres was `initdb`'d with on a genuinely fresh cluster
# (docs/DECISIONS.md D77's own "keep it postgres unless you've actually
# rotated" default); an existing cluster that rotated POSTGRES_PASSWORD
# to something else needs a human rerun of infra/aws/seed-localstack.sh
# (with $POSTGRES_PASSWORD set) after any LocalStack restart, same as
# this hook already can't help with anything infra/aws/seed-localstack.sh
# takes as a SEED_* override.
#
# ADMIN_PASSWORD_HASH/ADMIN_JWT_SECRET/ANTHROPIC_API_KEY (GitHub issue
# #466's own follow-up, D78) are different from every value above: they
# have no dev-only placeholder to hardcode here at all -- by this
# project's own explicit intent, ADMIN_PASSWORD_HASH/ADMIN_JWT_SECRET
# never have one (admin-auth.env.ts's own comment), so this reads the
# *real* values from its own environment instead
# (../08-localstack.yaml's env.valueFrom.secretKeyRef entries, sourced
# from the same admin-credentials/anthropic-credentials Secrets `api`
# used to read directly before this issue). This is what actually closes
# the durability gap: an unplanned restart now reseeds these with the
# real value, not a placeholder api would reject anyway.
set -euo pipefail

DATABASE_URL_VALUE="postgresql://postgres:postgres@postgres:5432/interview_insights?schema=public"
EMAIL_HASH_SECRET_VALUE="localstack-seeded-secret-change-me"
EMAIL_ENCRYPTION_KEY_VALUE="1111111111111111111111111111111111111111111111111111111111111111"
CANDIDATE_JWT_SECRET_VALUE="localstack-seeded-candidate-jwt-secret-change-me"
ADMIN_PASSWORD_HASH_VALUE="$ADMIN_PASSWORD_HASH"
ADMIN_JWT_SECRET_VALUE="$ADMIN_JWT_SECRET"
ANTHROPIC_API_KEY_VALUE="$ANTHROPIC_API_KEY"
ACCOUNT_ID="000000000000"

echo "[init-hook] seeding Secrets Manager"

awslocal secretsmanager delete-secret --secret-id interview-insights/database-url \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/database-url \
  --secret-string "$DATABASE_URL_VALUE" > /dev/null

awslocal secretsmanager delete-secret --secret-id interview-insights/email-hash-secret \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/email-hash-secret \
  --secret-string "$EMAIL_HASH_SECRET_VALUE" > /dev/null

awslocal secretsmanager delete-secret --secret-id interview-insights/email-encryption-key \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/email-encryption-key \
  --secret-string "$EMAIL_ENCRYPTION_KEY_VALUE" > /dev/null

awslocal secretsmanager delete-secret --secret-id interview-insights/candidate-jwt-secret \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/candidate-jwt-secret \
  --secret-string "$CANDIDATE_JWT_SECRET_VALUE" > /dev/null

awslocal secretsmanager delete-secret --secret-id interview-insights/admin-password-hash \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/admin-password-hash \
  --secret-string "$ADMIN_PASSWORD_HASH_VALUE" > /dev/null

awslocal secretsmanager delete-secret --secret-id interview-insights/admin-jwt-secret \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/admin-jwt-secret \
  --secret-string "$ADMIN_JWT_SECRET_VALUE" > /dev/null

# AWS Secrets Manager's CreateSecret rejects an empty SecretString --
# found the hard way, against a live cluster: seeding "" here aborted
# the rest of this script under set -e, silently skipping both roles'
# provisioning below. "Not configured" means this secret doesn't exist
# at all; api's fetchOptionalSecret() (D78) already treats that as ''.
if [ -n "$ANTHROPIC_API_KEY_VALUE" ]; then
  awslocal secretsmanager delete-secret --secret-id interview-insights/anthropic-api-key \
    --force-delete-without-recovery > /dev/null 2>&1 || true
  awslocal secretsmanager create-secret --name interview-insights/anthropic-api-key \
    --secret-string "$ANTHROPIC_API_KEY_VALUE" > /dev/null
else
  awslocal secretsmanager delete-secret --secret-id interview-insights/anthropic-api-key \
    --force-delete-without-recovery > /dev/null 2>&1 || true
fi

echo "[init-hook] seeding IAM"

provision_role_and_policy() {
  local role_name="$1"
  local policy_name="$2"
  local policy_doc="$3"

  awslocal iam detach-role-policy --role-name "$role_name" \
    --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${policy_name}" > /dev/null 2>&1 || true
  awslocal iam delete-role --role-name "$role_name" > /dev/null 2>&1 || true
  awslocal iam delete-policy --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${policy_name}" > /dev/null 2>&1 || true

  awslocal iam create-role --role-name "$role_name" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": { "AWS": "arn:aws:iam::000000000000:root" },
        "Action": "sts:AssumeRole"
      }
    ]
  }' > /dev/null

  awslocal iam create-policy --policy-name "$policy_name" --policy-document "$policy_doc" > /dev/null

  awslocal iam attach-role-policy --role-name "$role_name" \
    --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${policy_name}" > /dev/null
}

# Mirrors infra/aws/api-secrets-access-policy.json -- least-privilege,
# api's role can't read notification-service's own secrets and vice versa.
provision_role_and_policy "api-secrets-role" "api-secrets-access-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadApiSecretsOnly",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:interview-insights/email-hash-secret-*",
        "arn:aws:secretsmanager:*:*:secret:interview-insights/database-url-*",
        "arn:aws:secretsmanager:*:*:secret:interview-insights/email-encryption-key-*",
        "arn:aws:secretsmanager:*:*:secret:interview-insights/candidate-jwt-secret-*",
        "arn:aws:secretsmanager:*:*:secret:interview-insights/admin-password-hash-*",
        "arn:aws:secretsmanager:*:*:secret:interview-insights/admin-jwt-secret-*",
        "arn:aws:secretsmanager:*:*:secret:interview-insights/anthropic-api-key-*"
      ]
    }
  ]
}'

# Mirrors infra/aws/notification-service-secrets-access-policy.json.
provision_role_and_policy "notification-service-secrets-role" \
  "notification-service-secrets-access-policy" '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadNotificationServiceSecretsOnly",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:interview-insights/database-url-*",
        "arn:aws:secretsmanager:*:*:secret:interview-insights/email-encryption-key-*"
      ]
    }
  ]
}'

echo "[init-hook] done"
