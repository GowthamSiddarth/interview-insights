// Must be the very first import: everything below it — starting with
// `./app.module`, which pulls in AdminAuthModule's eager, module-init-time
// getRequiredAdminEnv('ADMIN_JWT_SECRET') read — needs `.env` already in
// process.env by the time its own module body runs. Before this, nothing
// in api/src called dotenv explicitly, so `.env` only reached process.env
// as an incidental side effect of @prisma/client's own auto-loading
// behavior; whether that had already run by the time a given env var was
// read depended entirely on module require order, not on anything
// explicit (GitHub issue #452). Reads a real ADMIN_PASSWORD_HASH-style
// eager var lazily and it "worked"; add one more eager read above
// PrismaModule in app.module.ts's import order and it wouldn't have.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
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
  // credentials: true is required for the admin_session cookie (GitHub
  // issue #159) to be sent/received cross-origin at all.
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true });

  // AdminJwtStrategy reads the session token from a cookie, not a header —
  // needs req.cookies populated before passport ever sees the request.
  app.use(cookieParser());

  // Every new endpoint validates input — see CLAUDE.md conventions.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
}

void bootstrap();
