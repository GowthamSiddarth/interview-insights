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
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { bootstrapSecretsFromLocalStack } from './secrets/localstack-secrets-bootstrap';

async function bootstrap() {
  // Must happen before NestFactory.create: PrismaService reads DATABASE_URL
  // from env at construction time, which happens as soon as Nest wires up
  // the module tree. No-op unless SECRETS_SOURCE=localstack is set (GitHub
  // issue #79, Phase 11).
  await bootstrapSecretsFromLocalStack();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // GitHub issue #777 (Phase 52) — every IP-based throttle guard keys off
  // req.ip, which collapses to ingress-nginx's own address for every
  // caller unless Express is told to trust its X-Forwarded-For hop.
  // ingress-nginx always overwrites any client-supplied X-Forwarded-For
  // rather than appending to it, so trusting exactly one hop is safe here.
  app.set('trust proxy', 1);

  // GitHub issue #778 (Phase 52) — X-Content-Type-Options, frame-ancestors/
  // CSP, HSTS, Referrer-Policy. contentSecurityPolicy stays default (no
  // HTML is served from this origin, only JSON), so nothing to tune for
  // web's origin specifically.
  app.use(helmet());

  // web/ runs on a different origin/port — without this, every browser
  // fetch from it fails preflight (caught by driving the app in a real
  // browser; curl doesn't enforce CORS so it doesn't surface this).
  // credentials: true is required for the admin_session cookie (GitHub
  // issue #159) to be sent/received cross-origin at all.
  // GitHub issue #780 (Phase 52) — no silent localhost fallback: every
  // real environment (local .env, every k8s overlay) already sets this
  // explicitly (see infra/k8s/base/05-api.yaml), so requiring it outright
  // only ever catches a genuinely missing/misconfigured deploy.
  if (!process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must be set.');
  }
  app.enableCors({ origin: process.env.CORS_ORIGIN, credentials: true });

  // AdminJwtStrategy reads the session token from a cookie, not a header —
  // needs req.cookies populated before passport ever sees the request.
  app.use(cookieParser());

  // Every new endpoint validates input — see CLAUDE.md conventions.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // GitHub issue #779 (Phase 52) — PrismaExceptionFilter must be checked
  // first (Nest resolves global filters by first array match): it fully
  // handles every Prisma error itself and never re-throws, so
  // AllExceptionsFilter only ever sees non-Prisma exceptions.
  app.useGlobalFilters(new PrismaExceptionFilter(), new AllExceptionsFilter());

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port);
}

void bootstrap();
