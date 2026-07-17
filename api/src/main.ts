import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { bootstrapSecretsFromLocalStack } from './secrets/localstack-secrets-bootstrap';

async function bootstrap() {
  // Must happen before NestFactory.create: PrismaService reads DATABASE_URL
  // from env at construction time, which happens as soon as Nest wires up
  // the module tree. No-op unless SECRETS_SOURCE=localstack is set (GitHub
  // issue #79, Phase 11).
  await bootstrapSecretsFromLocalStack();

  const app = await NestFactory.create(AppModule);

  // web/ runs on a different origin/port — without this, every browser
  // fetch from it fails preflight (caught by driving the app in a real
  // browser; curl doesn't enforce CORS so it doesn't surface this).
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000' });

  // Every new endpoint validates input — see CLAUDE.md conventions.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
}

void bootstrap();
