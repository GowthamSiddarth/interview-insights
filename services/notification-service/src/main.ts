import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { bootstrapSecretsFromLocalStack } from './secrets/localstack-secrets-bootstrap';

async function bootstrap() {
  // Must happen before NestFactory.create: PrismaService reads DATABASE_URL
  // from env at construction time, same reasoning as api/src/main.ts.
  // No-op unless SECRETS_SOURCE=localstack is set (GitHub issue #466).
  await bootstrapSecretsFromLocalStack();

  const app = await NestFactory.create(AppModule);
  // GitHub issue #778 (Phase 52) — same baseline headers as api/src/main.ts.
  app.use(helmet());
  const port = process.env.PORT ? Number(process.env.PORT) : 3002;
  await app.listen(port);
}

void bootstrap();
