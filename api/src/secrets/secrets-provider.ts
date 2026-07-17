import { Inject, Injectable } from '@nestjs/common';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SECRETS_MANAGER_CLIENT } from './secrets-manager-client.provider';

// Practice/validation only (GitHub issue #66, Phase 10) — NOT wired into
// any actually-deployed path. api still reads EMAIL_HASH_SECRET/
// DATABASE_URL from plain env vars everywhere else (docker-compose, k8s
// ConfigMap/Secret), unchanged. This proves the integration code works
// against a real (LocalStack-emulated locally) Secrets Manager API,
// ready for whenever a real Phase 8b trigger makes switching over worth
// it. See docs/DECISIONS.md D20.
@Injectable()
export class SecretsProvider {
  constructor(@Inject(SECRETS_MANAGER_CLIENT) private readonly client: SecretsManagerClient) {}

  async getSecret(secretId: string): Promise<string> {
    const response = await this.client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!response.SecretString) {
      throw new Error(`Secret "${secretId}" has no SecretString value.`);
    }
    return response.SecretString;
  }
}
