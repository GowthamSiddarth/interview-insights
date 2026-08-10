import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

// Fixed test-only credentials, shared across every e2e spec that needs to
// call a moderation route (GitHub issue #159, Phase 18). ADMIN_PASSWORD_HASH
// as set in CI (.github/workflows/ci.yml) and documented in
// api/.env.example is a precomputed bcrypt hash of this exact plaintext —
// never a real credential.
export const ADMIN_TEST_USERNAME = 'admin';
export const ADMIN_TEST_PASSWORD = 'dev-only-admin-password';

// Logs in once and returns the raw Set-Cookie value so callers can attach
// it via .set('Cookie', ...) to any subsequent supertest request.
export async function loginAsAdmin(app: INestApplication): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const res = await request(app.getHttpServer())
    .post('/auth/admin/login')
    .send({ username: ADMIN_TEST_USERNAME, password: ADMIN_TEST_PASSWORD })
    .expect(200);
  const cookies = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  if (!cookies || (Array.isArray(cookies) && cookies.length === 0)) {
    throw new Error('Admin login did not set a session cookie.');
  }
  return Array.isArray(cookies) ? cookies[0] : cookies;
}

const SECOND_MODERATOR_USERNAME = 'second-moderator';
const SECOND_MODERATOR_PASSWORD = 'dev-only-second-moderator-password';

// GitHub issue #487 (Phase 36) — claim/release is the first thing in this
// project that actually needs *two* distinct moderator identities in the
// same test (proving one moderator can't release another's claim).
// AdminAuthService.onModuleInit only ever seeds the single env-configured
// moderator (#485), so a second one is inserted directly here — same
// bypass-the-app-layer pattern moderation.e2e-spec.ts's own rawPrisma
// already uses to simulate state the app itself would never produce
// through a real endpoint. Upserted under a fixed username rather than a
// fresh one per call: `moderators` isn't one of truncate-database.ts's
// wiped tables (moderator identities, like the env-seeded admin one,
// persist across test runs same as production would), so a fresh
// timestamped username every call would just accumulate rows forever
// instead of reusing the same one. Opens and closes its own connection per
// call (rather than a shared module-level client) so this support module
// never leaves an open Prisma handle behind for whichever spec imports it.
export async function loginAsSecondModerator(
  app: INestApplication,
): Promise<{ id: string; cookie: string }> {
  const prisma = new PrismaClient();
  let moderatorId: string;
  try {
    const passwordHash = await bcrypt.hash(SECOND_MODERATOR_PASSWORD, 10);
    const moderator = await prisma.moderator.upsert({
      where: { username: SECOND_MODERATOR_USERNAME },
      create: { username: SECOND_MODERATOR_USERNAME, passwordHash, email: 'second-moderator@example.com' },
      update: { passwordHash },
    });
    moderatorId = moderator.id;
  } finally {
    await prisma.$disconnect();
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const res = await request(app.getHttpServer())
    .post('/auth/admin/login')
    .send({ username: SECOND_MODERATOR_USERNAME, password: SECOND_MODERATOR_PASSWORD })
    .expect(200);
  const cookies = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  if (!cookies || (Array.isArray(cookies) && cookies.length === 0)) {
    throw new Error('Second moderator login did not set a session cookie.');
  }
  return { id: moderatorId, cookie: Array.isArray(cookies) ? cookies[0] : cookies };
}
