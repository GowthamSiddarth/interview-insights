import { Test, TestingModule } from '@nestjs/testing';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { SecretsProvider } from '../src/secrets/secrets-provider';
import { SECRETS_MANAGER_CLIENT } from '../src/secrets/secrets-manager-client.provider';

// Requires LocalStack running locally with AWS_ENDPOINT_URL set (see
// README.md) — proves SecretsProvider works against a real Secrets
// Manager API (emulated), not just a mocked client. Skips gracefully
// rather than failing when LocalStack isn't running: this is opt-in
// local practice (GitHub issue #66, Phase 10), not a hard requirement of
// the standard `npm run test:e2e` loop everyone else already relies on.
// See docs/DECISIONS.md D20.
const endpoint = process.env.AWS_ENDPOINT_URL;
const describeIfLocalStack = endpoint ? describe : describe.skip;

if (!endpoint) {
  console.log(
    'Skipping secrets-provider.e2e-spec.ts: AWS_ENDPOINT_URL not set (LocalStack not running).',
  );
}

describeIfLocalStack('SecretsProvider (e2e, against LocalStack)', () => {
  let secretsProvider: SecretsProvider;
  let managementClient: SecretsManagerClient;
  const secretName = `test-secret-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  beforeAll(async () => {
    managementClient = new SecretsManagerClient({
      region: 'us-east-1',
      endpoint,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });
    await managementClient.send(
      new CreateSecretCommand({ Name: secretName, SecretString: 'super-secret-value' }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsProvider,
        { provide: SECRETS_MANAGER_CLIENT, useValue: managementClient },
      ],
    }).compile();
    secretsProvider = module.get(SecretsProvider);
  });

  afterAll(async () => {
    await managementClient.send(
      new DeleteSecretCommand({ SecretId: secretName, ForceDeleteWithoutRecovery: true }),
    );
  });

  it('fetches the real secret value from LocalStack', async () => {
    const value = await secretsProvider.getSecret(secretName);
    expect(value).toBe('super-secret-value');
  });

  it('rejects a secret ID that was never created', async () => {
    await expect(secretsProvider.getSecret(`does-not-exist-${Date.now()}`)).rejects.toThrow();
  });
});
