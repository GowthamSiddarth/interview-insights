import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { localstackAwsClientConfig } from './aws-client-config.util';

const DATABASE_URL_SECRET_ID = 'interview-insights/database-url';
// Genuinely optional (same as api's own copy pre-#340, D78) — "not
// configured" is a valid, deliberate state: an unset ANTHROPIC_API_KEY just
// leaves this service's triage disabled (isAiModerationEnabled() false).
// Fetched via fetchOptionalSecret below, not fetchSecret.
const ANTHROPIC_API_KEY_SECRET_ID = 'interview-insights/anthropic-api-key';

// Own copy of api/src/secrets/localstack-secrets-bootstrap.ts (GitHub issue
// #340, D75/D81's duplicate-rather-than-share precedent, same shape
// notification-service already established) — reads the same
// interview-insights/database-url secret api does (same Postgres) plus
// interview-insights/anthropic-api-key (D78's optional-secret pattern, now
// read here instead of by api — the LLM only gets called from this service
// as of #340), via its own IAM role/policy
// (review-analyzer-secrets-role, infra/aws/
// review-analyzer-secrets-access-policy.json) — least-privilege: this role
// can't read any of api's other secrets.
//
// Only runs when SECRETS_SOURCE=localstack is set (see
// infra/k8s/overlays/dev/review-analyzer-config-patch.yaml).
//
// Must run before NestFactory.create(AppModule) — same PrismaClient
// env-read-at-construction-time reasoning as api's/notification-service's
// own copies.
//
// Deliberately throws rather than falling back silently for DATABASE_URL,
// same reasoning as api's own copy: a candidate opting into
// SECRETS_SOURCE=localstack and silently getting no real DATABASE_URL would
// boot against nothing.
export async function bootstrapSecretsFromLocalStack(): Promise<void> {
  if (process.env.SECRETS_SOURCE !== 'localstack') {
    return;
  }

  const roleArn = process.env.AWS_SECRETS_ROLE_ARN;
  if (!roleArn) {
    throw new Error('AWS_SECRETS_ROLE_ARN must be set when SECRETS_SOURCE=localstack.');
  }

  const config = localstackAwsClientConfig();
  const sts = new STSClient(config);
  const assumed = await sts.send(
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: 'review-analyzer-boot' }),
  );
  const creds = assumed.Credentials;
  if (!creds?.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    throw new Error(`Failed to assume role ${roleArn}: no temporary credentials returned.`);
  }

  const secretsManager = new SecretsManagerClient({
    ...config,
    credentials: {
      accessKeyId: creds.AccessKeyId,
      secretAccessKey: creds.SecretAccessKey,
      sessionToken: creds.SessionToken,
    },
  });

  const [databaseUrl, anthropicApiKey] = await Promise.all([
    fetchSecret(secretsManager, DATABASE_URL_SECRET_ID),
    fetchOptionalSecret(secretsManager, ANTHROPIC_API_KEY_SECRET_ID),
  ]);

  process.env.DATABASE_URL = databaseUrl;
  process.env.ANTHROPIC_API_KEY = anthropicApiKey;
}

async function fetchSecret(client: SecretsManagerClient, secretId: string): Promise<string> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error(`Secret "${secretId}" has no SecretString value.`);
  }
  return response.SecretString;
}

// D78 — unlike fetchSecret, a missing secret is a valid result here, not a
// failure: ANTHROPIC_API_KEY is genuinely optional
// (isAiModerationEnabled() already treats '' exactly like unset), and "not
// configured" is represented by the Secrets Manager entry not existing at
// all. Any other failure still propagates — only a missing secret is a
// valid "disabled" state, not e.g. a network error or a misconfigured role.
async function fetchOptionalSecret(
  client: SecretsManagerClient,
  secretId: string,
): Promise<string> {
  try {
    const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    return response.SecretString ?? '';
  } catch (err) {
    if (err instanceof Error && err.name === 'ResourceNotFoundException') {
      return '';
    }
    throw err;
  }
}
