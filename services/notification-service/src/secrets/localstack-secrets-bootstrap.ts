import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { localstackAwsClientConfig } from './aws-client-config.util';

const DATABASE_URL_SECRET_ID = 'interview-insights/database-url';
const EMAIL_ENCRYPTION_KEY_SECRET_ID = 'interview-insights/email-encryption-key';

// Own copy of api/src/secrets/localstack-secrets-bootstrap.ts (GitHub
// issue #466, D73/D75's duplicate-rather-than-share precedent) — reads
// the same interview-insights/database-url and
// interview-insights/email-encryption-key secrets api does (same
// Postgres; D74 requires this service's EMAIL_ENCRYPTION_KEY be
// byte-identical to api's own, since it can only decrypt what api
// encrypted), via its own IAM role/policy
// (notification-service-secrets-role, infra/aws/
// notification-service-secrets-access-policy.json) — least-privilege:
// this role can't read email-hash-secret/candidate-jwt-secret, which
// only api needs.
//
// Only runs when SECRETS_SOURCE=localstack is set (see
// infra/k8s/overlays/dev/notification-service-config-patch.yaml).
//
// Must run before NestFactory.create(AppModule) — same PrismaClient
// env-read-at-construction-time reasoning as api's own copy.
//
// Deliberately throws rather than falling back silently, same reasoning
// as api's own copy: a candidate opting into SECRETS_SOURCE=localstack
// and silently getting no real DATABASE_URL would boot against nothing.
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
    new AssumeRoleCommand({ RoleArn: roleArn, RoleSessionName: 'notification-service-boot' }),
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

  const [databaseUrl, emailEncryptionKey] = await Promise.all([
    fetchSecret(secretsManager, DATABASE_URL_SECRET_ID),
    fetchSecret(secretsManager, EMAIL_ENCRYPTION_KEY_SECRET_ID),
  ]);

  process.env.DATABASE_URL = databaseUrl;
  process.env.EMAIL_ENCRYPTION_KEY = emailEncryptionKey;
}

async function fetchSecret(client: SecretsManagerClient, secretId: string): Promise<string> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error(`Secret "${secretId}" has no SecretString value.`);
  }
  return response.SecretString;
}
