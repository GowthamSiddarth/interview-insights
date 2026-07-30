import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { localstackAwsClientConfig } from './aws-client-config.util';

const DATABASE_URL_SECRET_ID = 'interview-insights/database-url';
const EMAIL_HASH_SECRET_SECRET_ID = 'interview-insights/email-hash-secret';
const EMAIL_ENCRYPTION_KEY_SECRET_ID = 'interview-insights/email-encryption-key';
const CANDIDATE_JWT_SECRET_SECRET_ID = 'interview-insights/candidate-jwt-secret';
const ADMIN_PASSWORD_HASH_SECRET_ID = 'interview-insights/admin-password-hash';
const ADMIN_JWT_SECRET_SECRET_ID = 'interview-insights/admin-jwt-secret';
// Genuinely optional (GitHub issue #163) — unlike every other secret
// here, an empty value is a valid, deliberate "feature disabled" state,
// not a misconfiguration. Fetched via fetchOptionalSecret below, not
// fetchSecret (D78).
const ANTHROPIC_API_KEY_SECRET_ID = 'interview-insights/anthropic-api-key';

// Opt-in (GitHub issue #79, Phase 11): only runs when SECRETS_SOURCE=
// localstack is set (see infra/k8s/overlays/dev's api-config patch) —
// every other environment (docker-compose) keeps reading these from
// plain env vars, completely unchanged. GitHub issue #466 (D76) folded
// the once-separate `dev-localstack` overlay into `dev` itself and
// removed the plaintext-Secret fallback these values used to carry
// in infra/k8s/base/05-api.yaml — `dev` now requires LocalStack
// unconditionally, so this is no longer truly "opt-in" for that overlay,
// just still gated behind the same env var for docker-compose's sake.
// GitHub issue #466's own follow-up (D78) added the last two secrets
// that used to bypass this bootstrap entirely (admin-credentials/
// anthropic-credentials, wired directly into api's Deployment) — every
// secret api reads now comes from exactly this one path.
//
// Must run before NestFactory.create(AppModule): PrismaService's
// PrismaClient reads DATABASE_URL from env at construction time (it
// `extends PrismaClient`), which happens the moment Nest wires up the
// module tree — by then it's too late to still be fetching secrets.
//
// Deliberately throws rather than falling back silently on any failure:
// unlike search indexing (D16, a derived/secondary store safe to fail
// best-effort), a candidate opting into SECRETS_SOURCE=localstack and
// silently getting no real DATABASE_URL would boot against nothing, or
// mask a real config mistake — better to fail loudly at boot.
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
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: 'api-boot' }),
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

  const [
    databaseUrl,
    emailHashSecret,
    emailEncryptionKey,
    candidateJwtSecret,
    adminPasswordHash,
    adminJwtSecret,
    anthropicApiKey,
  ] = await Promise.all([
    fetchSecret(secretsManager, DATABASE_URL_SECRET_ID),
    fetchSecret(secretsManager, EMAIL_HASH_SECRET_SECRET_ID),
    fetchSecret(secretsManager, EMAIL_ENCRYPTION_KEY_SECRET_ID),
    fetchSecret(secretsManager, CANDIDATE_JWT_SECRET_SECRET_ID),
    fetchSecret(secretsManager, ADMIN_PASSWORD_HASH_SECRET_ID),
    fetchSecret(secretsManager, ADMIN_JWT_SECRET_SECRET_ID),
    fetchOptionalSecret(secretsManager, ANTHROPIC_API_KEY_SECRET_ID),
  ]);

  process.env.DATABASE_URL = databaseUrl;
  process.env.EMAIL_HASH_SECRET = emailHashSecret;
  process.env.EMAIL_ENCRYPTION_KEY = emailEncryptionKey;
  process.env.CANDIDATE_JWT_SECRET = candidateJwtSecret;
  process.env.ADMIN_PASSWORD_HASH = adminPasswordHash;
  process.env.ADMIN_JWT_SECRET = adminJwtSecret;
  process.env.ANTHROPIC_API_KEY = anthropicApiKey;
}

async function fetchSecret(client: SecretsManagerClient, secretId: string): Promise<string> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error(`Secret "${secretId}" has no SecretString value.`);
  }
  return response.SecretString;
}

// D78 — unlike fetchSecret, an empty SecretString is a valid result here,
// not a failure: ANTHROPIC_API_KEY is genuinely optional
// (isAiModerationEnabled() already treats '' exactly like unset), so a
// LocalStack-seeded empty string must round-trip as '', not throw.
async function fetchOptionalSecret(
  client: SecretsManagerClient,
  secretId: string,
): Promise<string> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  return response.SecretString ?? '';
}
