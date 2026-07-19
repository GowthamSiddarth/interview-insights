#!/usr/bin/env bash
# LocalStack init-hook (https://docs.localstack.cloud/user-guide/lifecycle-hooks/):
# any script under /etc/localstack/init/ready.d/ runs automatically every
# time LocalStack finishes starting -- including after an *unplanned*
# restart, not just a deliberate `kubectl apply`/CD run. LocalStack's
# Deployment (../08-localstack.yaml) deliberately has no PVC (issue #78 --
# "not a source of truth"), so an unplanned restart wipes its Secrets
# Manager/IAM state; without this hook, `api` crash-loops until a human
# notices and reruns infra/aws/seed-localstack.sh by hand (the gotcha
# documented in wiki/deployment-guide.md section 3). This makes that
# recovery automatic instead.
#
# Deliberately NOT the same script as infra/aws/seed-localstack.sh: that
# one runs *outside* the container (CD, bootstrap-kind.sh, a human) and
# needs an explicit --endpoint-url/region/fake credentials; this one runs
# *inside* the LocalStack container itself, where the bundled `awslocal`
# wrapper needs none of that, and doesn't need the human-facing
# assumed-role verification step. If the secret names, role name, policy
# name, or infra/aws/api-secrets-access-policy.json's contents ever
# change, keep both in sync -- coupled by convention, not shared code,
# same as this project's overlay pairs already are.
set -euo pipefail

DATABASE_URL_VALUE="postgresql://postgres:postgres@postgres:5432/interview_insights?schema=public"
EMAIL_HASH_SECRET_VALUE="localstack-seeded-secret-change-me"
ACCOUNT_ID="000000000000"
ROLE_NAME="api-secrets-role"
POLICY_NAME="api-secrets-access-policy"

echo "[init-hook] seeding Secrets Manager + IAM"

awslocal secretsmanager delete-secret --secret-id interview-insights/database-url \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/database-url \
  --secret-string "$DATABASE_URL_VALUE" > /dev/null

awslocal secretsmanager delete-secret --secret-id interview-insights/email-hash-secret \
  --force-delete-without-recovery > /dev/null 2>&1 || true
awslocal secretsmanager create-secret --name interview-insights/email-hash-secret \
  --secret-string "$EMAIL_HASH_SECRET_VALUE" > /dev/null

awslocal iam detach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}" > /dev/null 2>&1 || true
awslocal iam delete-role --role-name "$ROLE_NAME" > /dev/null 2>&1 || true
awslocal iam delete-policy --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}" > /dev/null 2>&1 || true

awslocal iam create-role --role-name "$ROLE_NAME" --assume-role-policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::000000000000:root" },
      "Action": "sts:AssumeRole"
    }
  ]
}' > /dev/null

awslocal iam create-policy --policy-name "$POLICY_NAME" --policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadApiSecretsOnly",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": [
        "arn:aws:secretsmanager:*:*:secret:interview-insights/email-hash-secret-*",
        "arn:aws:secretsmanager:*:*:secret:interview-insights/database-url-*"
      ]
    }
  ]
}' > /dev/null

awslocal iam attach-role-policy --role-name "$ROLE_NAME" \
  --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/${POLICY_NAME}" > /dev/null

echo "[init-hook] done"
