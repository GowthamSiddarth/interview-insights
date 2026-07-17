import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { localstackAwsClientConfig } from './aws-client-config.util';

const DATABASE_URL_SECRET_ID = 'interview-insights/database-url';
const EMAIL_HASH_SECRET_SECRET_ID = 'interview-insights/email-hash-secret';

// Opt-in (GitHub issue #79, Phase 11): only runs when SECRETS_SOURCE=
// localstack is set (see infra/k8s/overlays/dev-localstack's api-config
// patch) — every other environment (docker-compose, the plain `dev`
// overlay) keeps reading DATABASE_URL/EMAIL_HASH_SECRET from plain env
// vars/the k8s Secret, completely unchanged.
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

  const [databaseUrl, emailHashSecret] = await Promise.all([
    fetchSecret(secretsManager, DATABASE_URL_SECRET_ID),
    fetchSecret(secretsManager, EMAIL_HASH_SECRET_SECRET_ID),
  ]);

  process.env.DATABASE_URL = databaseUrl;
  process.env.EMAIL_HASH_SECRET = emailHashSecret;
}

async function fetchSecret(client: SecretsManagerClient, secretId: string): Promise<string> {
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error(`Secret "${secretId}" has no SecretString value.`);
  }
  return response.SecretString;
}
