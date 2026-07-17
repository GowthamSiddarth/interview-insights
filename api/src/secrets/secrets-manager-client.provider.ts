import { Provider } from '@nestjs/common';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export const SECRETS_MANAGER_CLIENT = 'SECRETS_MANAGER_CLIENT';

// AWS_ENDPOINT_URL set = talking to LocalStack locally, which needs
// dummy static credentials. Unset = real AWS SDK default credential
// chain (IAM role, etc.) — never exercised today, since SecretsModule
// isn't imported by AppModule (GitHub issue #66, Phase 10; see
// docs/DECISIONS.md D20).
export const secretsManagerClientProvider: Provider = {
  provide: SECRETS_MANAGER_CLIENT,
  useFactory: () =>
    new SecretsManagerClient({
      region: process.env.AWS_REGION ?? 'us-east-1',
      ...(process.env.AWS_ENDPOINT_URL
        ? {
            endpoint: process.env.AWS_ENDPOINT_URL,
            credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
          }
        : {}),
    }),
};
