import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import {
  ADMIN_TEST_PASSWORD,
  ADMIN_TEST_USERNAME,
  loginAsSecondModerator,
  SECOND_MODERATOR_USERNAME,
} from './support/admin-session';

function body<T>(res: request.Response): T {
  return res.body as T;
}

async function bootApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.use(cookieParser());
  await app.init();
  return app;
}

// Proves GitHub issue #159's acceptance criteria end to end: login issues
// an httpOnly session cookie, every ModerationController route 401s
// without one, a valid session unlocks them, logout clears the cookie,
// and the login endpoint itself trips its own rate limit. Also covers
// GET /auth/admin/me (issue #160's session-check endpoint for web).
describe('Admin auth (e2e)', () => {
  let app: INestApplication;
  // Captured once from the first successful login below and reused by the
  // later tests, rather than each calling loginAsAdmin() again — keeps
  // this file's total login-attempt count on the shared `app` well clear
  // of LoginThrottleService's window, which the dedicated rate-limit test
  // below deliberately exercises on its own isolated app instance.
  let adminCookie: string;

  beforeAll(async () => {
    app = await bootApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  it('logs in with valid credentials and sets an httpOnly, non-JSON session cookie', async () => {
    const res = await server()
      .post('/auth/admin/login')
      .send({ username: ADMIN_TEST_USERNAME, password: ADMIN_TEST_PASSWORD })
      .expect(200);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies).toBeDefined();
    const sessionCookie = cookies.find((c) => c.startsWith('admin_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/httponly/i);
    // Regression test: a Secure cookie is silently refused by every
    // browser over plain HTTP, which every environment this project runs
    // in today is (no COOKIE_SECURE env var set here == unset == false).
    // A prior version keyed this off NODE_ENV === 'production' instead,
    // which is true in every deployed container regardless of whether
    // it's actually served over HTTPS — that bug made login look broken
    // through the real kind-deployed app (200 response, cookie silently
    // dropped) despite every curl-based/mocked-fetch test passing.
    expect(sessionCookie).not.toMatch(/secure/i);
    // Never returned in the JSON body — web never handles the raw token in JS.
    expect(JSON.stringify(res.body)).not.toMatch(/admin_session|eyJ/i);

    adminCookie = sessionCookie as string;
  });

  it('rejects an incorrect password with 401', async () => {
    await server()
      .post('/auth/admin/login')
      .send({ username: ADMIN_TEST_USERNAME, password: 'definitely-wrong' })
      .expect(401);
  });

  it('rejects an incorrect username with 401', async () => {
    await server()
      .post('/auth/admin/login')
      .send({ username: 'not-the-admin', password: ADMIN_TEST_PASSWORD })
      .expect(401);
  });

  it('rejects a moderation route request with no session cookie', async () => {
    await server().get('/moderation/queue').expect(401);
  });

  it('rejects a moderation route request with a garbage cookie', async () => {
    await server().get('/moderation/queue').set('Cookie', 'admin_session=not-a-real-jwt').expect(401);
  });

  it('accepts a moderation route request with a valid session cookie', async () => {
    await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
  });

  it('GET /auth/admin/me reflects session state', async () => {
    await server().get('/auth/admin/me').expect(401);

    const res = await server().get('/auth/admin/me').set('Cookie', adminCookie).expect(200);
    // id is a real Moderator UUID as of GitHub issue #485 (Phase 36) —
    // seeded fresh by AdminAuthService.onModuleInit, not a fixed value.
    // role is 'admin' as of GitHub issue #586/#587 (Phase 42, D99) —
    // AdminAuthService.onModuleInit always promotes the boot-seeded root
    // identity to 'admin' regardless of the column's own schema default.
    expect(body<{ id: string; username: string; role: string }>(res)).toEqual({
      id: expect.any(String) as string,
      username: ADMIN_TEST_USERNAME,
      role: 'admin',
    });
  });

  it('logout clears the session cookie', async () => {
    const logoutRes = await server().post('/auth/admin/logout').set('Cookie', adminCookie).expect(200);
    const clearedCookie = (logoutRes.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('admin_session='),
    );
    expect(clearedCookie).toBeDefined();

    // Re-attaching the now-cleared cookie value (an empty string) must
    // still 401 — proves logout doesn't just look like it worked client-side.
    await server().get('/moderation/queue').set('Cookie', clearedCookie ?? '').expect(401);
  });

  // GitHub issue #589 (Phase 42, D99) — self-service password change,
  // available to every role, gated only on the caller's own current
  // password. Uses the second-moderator identity (not the shared
  // adminCookie) so it doesn't disturb ADMIN_TEST_PASSWORD, which every
  // other e2e spec's loginAsAdmin() relies on staying correct — the
  // second-moderator's password is self-healing anyway (loginAsSecondModerator
  // re-upserts it on every call), but there's no reason to depend on that
  // here too.
  //
  // Its own isolated app instance, same reasoning as the dedicated
  // rate-limit test below: this block alone makes 5 real login attempts
  // across its three tests (LoginThrottleService's IpThrottle is keyed by
  // IP, not username, with a limit of 5 per 15-minute window) — on the
  // shared `app` above, that would land on top of the 3 attempts the
  // earlier tests in this file already make and start tripping 429s
  // partway through, exactly the trap this file's own top-level comment
  // already documents for the rate-limit test.
  describe('POST /auth/admin/change-password', () => {
    let changePasswordApp: INestApplication;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
    const changePasswordServer = () => request(changePasswordApp.getHttpServer());

    beforeAll(async () => {
      changePasswordApp = await bootApp();
    });

    afterAll(async () => {
      await changePasswordApp.close();
    });

    it('changes the password when the current password is correct, and the new one logs in', async () => {
      const { cookie } = await loginAsSecondModerator(changePasswordApp);

      await changePasswordServer()
        .post('/auth/admin/change-password')
        .set('Cookie', cookie)
        .send({ currentPassword: 'dev-only-second-moderator-password', newPassword: 'a-new-strong-password' })
        .expect(200);

      await changePasswordServer()
        .post('/auth/admin/login')
        .send({ username: SECOND_MODERATOR_USERNAME, password: 'a-new-strong-password' })
        .expect(200);
      await changePasswordServer()
        .post('/auth/admin/login')
        .send({ username: SECOND_MODERATOR_USERNAME, password: 'dev-only-second-moderator-password' })
        .expect(401);
    });

    it('rejects a wrong current password with 401, without changing anything', async () => {
      const { cookie } = await loginAsSecondModerator(changePasswordApp);

      await changePasswordServer()
        .post('/auth/admin/change-password')
        .set('Cookie', cookie)
        .send({ currentPassword: 'not-the-real-password', newPassword: 'a-new-strong-password' })
        .expect(401);

      await changePasswordServer()
        .post('/auth/admin/login')
        .send({ username: SECOND_MODERATOR_USERNAME, password: 'dev-only-second-moderator-password' })
        .expect(200);
    });

    it('rejects an unauthenticated request with 401', async () => {
      await changePasswordServer()
        .post('/auth/admin/change-password')
        .send({ currentPassword: 'x', newPassword: 'a-new-strong-password' })
        .expect(401);
    });
  });

  // Isolated in its own app instance so this test's LoginThrottleService
  // starts with zero prior attempts, rather than competing for count with
  // every earlier test in this file against the shared app above.
  it('rate-limits the login endpoint after repeated attempts', async () => {
    const throttledApp = await bootApp();
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
      const throttledServer = () => request(throttledApp.getHttpServer());
      for (let i = 0; i < 5; i++) {
        await throttledServer()
          .post('/auth/admin/login')
          .send({ username: ADMIN_TEST_USERNAME, password: 'wrong-on-purpose' })
          .expect(401);
      }
      await throttledServer()
        .post('/auth/admin/login')
        .send({ username: ADMIN_TEST_USERNAME, password: ADMIN_TEST_PASSWORD })
        .expect(429);
    } finally {
      await throttledApp.close();
    }
  });
});
