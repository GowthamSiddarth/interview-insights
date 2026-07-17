import { Module } from '@nestjs/common';
import { secretsManagerClientProvider } from './secrets-manager-client.provider';
import { SecretsProvider } from './secrets-provider';

// Deliberately not imported by AppModule — practice/validation only, see
// SecretsProvider's own comment and docs/DECISIONS.md D20.
@Module({
  providers: [secretsManagerClientProvider, SecretsProvider],
  exports: [SecretsProvider],
})
export class SecretsModule {}
