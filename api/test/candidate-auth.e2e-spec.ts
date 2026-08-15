import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { getMailpitMessage, waitForMailpitMessage } from './support/mailpit';

interface CandidateBody {
  id: string;
  verificationStatus: string;
  verifiedAt: string | null;
}
interface StatusBody {
  status: string;
}

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

// Proves GitHub issue #145's acceptance criteria end to end against real
// Postgres + Mailpit: requesting a link emails a real, single-use,
// expiring token (extracted from Mailpit, not returned by the API —
// unlike the superseded candidate-verification flow); verifying it
// issues an httpOnly session cookie and flips verificationStatus on
// first login; the token can't be reused; the endpoint rate-limits.
describe('Candidate magic-link auth (e2e)', () => {
  let app: INestApplication;

  // A fresh app (and therefore a fresh, empty MagicLinkThrottleService)
  // per test, not a shared beforeAll one — several tests here need more
  // than one /auth/request-link call each (supersession, re-fetching a
  // link), and a shared instance's cumulative count across the whole
  // file trips the 5-per-window throttle well before reaching later
  // tests, the same class of bug admin-auth.e2e-spec.ts's dedicated
  // rate-limit test already had to work around once.
  beforeEach(async () => {
    app = await bootApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function requestMagicLinkToken(email: string): Promise<string> {
    await server().post('/auth/request-link').send({ email }).expect(200);
    const message = await waitForMailpitMessage(email);
    const full = await getMailpitMessage(message.ID);
    const token = /token=([0-9a-f]{64})/.exec(full.Text)?.[1];
    if (!token) throw new Error(`No token found in the email sent to ${email}`);
    return token;
  }

  it('request-link always returns the same shape, whether or not the email is known', async () => {
    const res = await server().post('/auth/request-link').send({ email: uniqueEmail() }).expect(200);
    expect(body<StatusBody>(res)).toEqual({ status: 'ok' });
  });

  it('a real magic-link email is sent, and consuming it starts a session', async () => {
    const email = uniqueEmail();
    const token = await requestMagicLinkToken(email);

    const verifyRes = await server().get(`/auth/verify?token=${token}`).expect(200);
    expect(body<StatusBody>(verifyRes)).toEqual({ status: 'ok' });

    const cookies = verifyRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('candidate_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/httponly/i);
    expect(sessionCookie).not.toMatch(/secure/i); // COOKIE_SECURE unset in this test env
  }, 15000);

  it('first login flips verificationStatus to email_verified against real Postgres', async () => {
    // Unit tests (candidate-auth.service.spec.ts) already cover the
    // unverified -> email_verified transition logic itself, including the
    // first-login-only nuance, against a mocked Prisma. This proves the
    // same real write actually lands in real Postgres — there's no public
    // way left to inspect the pre-verification state (POST /candidates
    // was removed by this same issue, #146), so the candidateId is
    // decoded from the session cookie's JWT payload, only available
    // *after* verifying.
    const email = uniqueEmail();
    const token = await requestMagicLinkToken(email);

    const verifyRes = await server().get(`/auth/verify?token=${token}`).expect(200);
    const cookies = verifyRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('candidate_session='));
    const jwt = sessionCookie?.split(';')[0].split('=')[1] ?? '';
    const candidateId = (
      JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()) as { candidateId: string }
    ).candidateId;

    const after = await server().get(`/candidates/${candidateId}`).expect(200);
    expect(body<CandidateBody>(after).verificationStatus).toBe('email_verified');
    expect(body<CandidateBody>(after).verifiedAt).not.toBeNull();
  }, 15000);

  it('also accepts POST /auth/verify with the token in the body', async () => {
    const email = uniqueEmail();
    const token = await requestMagicLinkToken(email);

    const res = await server().post('/auth/verify').send({ token }).expect(200);
    expect(body<StatusBody>(res)).toEqual({ status: 'ok' });
  }, 15000);

  it('rejects reusing an already-consumed token', async () => {
    const email = uniqueEmail();
    const token = await requestMagicLinkToken(email);

    await server().get(`/auth/verify?token=${token}`).expect(200);
    await server().get(`/auth/verify?token=${token}`).expect(409);
  }, 15000);

  it('rejects an unknown token', async () => {
    await server().get(`/auth/verify?token=${'a'.repeat(64)}`).expect(404);
  });

  it('requesting a new link supersedes the previous one for that candidate', async () => {
    const email = uniqueEmail();
    const firstToken = await requestMagicLinkToken(email);
    await requestMagicLinkToken(email);

    // The first token was superseded, not just left dangling — behaves
    // like an already-used token.
    await server().get(`/auth/verify?token=${firstToken}`).expect(409);
  }, 20000);

  it('logout clears the session cookie', async () => {
    const email = uniqueEmail();
    const token = await requestMagicLinkToken(email);
    const verifyRes = await server().get(`/auth/verify?token=${token}`).expect(200);
    const cookies = verifyRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('candidate_session='));

    const logoutRes = await server()
      .post('/auth/logout')
      .set('Cookie', sessionCookie ?? '')
      .expect(200);
    const clearedCookie = (logoutRes.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('candidate_session='),
    );
    expect(clearedCookie).toBeDefined();
  }, 15000);

  it('rate-limits the request-link endpoint after repeated attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await server().post('/auth/request-link').send({ email: uniqueEmail() }).expect(200);
    }
    await server().post('/auth/request-link').send({ email: uniqueEmail() }).expect(429);
  }, 20000);

  it('GET /auth/me reflects session state', async () => {
    await server().get('/auth/me').expect(401);

    const email = uniqueEmail();
    const token = await requestMagicLinkToken(email);
    const verifyRes = await server().get(`/auth/verify?token=${token}`).expect(200);
    const cookies = verifyRes.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('candidate_session='));

    const res = await server().get('/auth/me').set('Cookie', sessionCookie ?? '').expect(200);
    expect(typeof body<{ candidateId: string }>(res).candidateId).toBe('string');
  }, 15000);
});

// GitHub issue #680 (Phase 48, D104) — password registration, against
// real Postgres + Mailpit.
describe('Candidate password registration (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await bootApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function requestMagicLinkToken(email: string): Promise<string> {
    await server().post('/auth/request-link').send({ email }).expect(200);
    const message = await waitForMailpitMessage(email);
    const full = await getMailpitMessage(message.ID);
    const token = /token=([0-9a-f]{64})/.exec(full.Text)?.[1];
    if (!token) throw new Error(`No token found in the email sent to ${email}`);
    return token;
  }

  it('registering starts a session immediately and sends a real verification email', async () => {
    const email = uniqueEmail();

    const res = await server().post('/auth/register').send({ email, password: 'a-strong-password' }).expect(201);
    expect(body<StatusBody>(res)).toEqual({ status: 'ok' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('candidate_session='));
    expect(sessionCookie).toBeDefined();

    const meRes = await server().get('/auth/me').set('Cookie', sessionCookie ?? '').expect(200);
    expect(typeof body<{ candidateId: string }>(meRes).candidateId).toBe('string');

    const message = await waitForMailpitMessage(email);
    expect(message.Subject).toContain('Verify');
  }, 15000);

  it('rejects a password shorter than 12 characters', async () => {
    await server().post('/auth/register').send({ email: uniqueEmail(), password: 'short' }).expect(400);
  });

  it('rejects re-registering an email that already has a password set', async () => {
    const email = uniqueEmail();
    await server().post('/auth/register').send({ email, password: 'a-strong-password' }).expect(201);

    await server().post('/auth/register').send({ email, password: 'a-different-password' }).expect(409);
  }, 15000);

  it('lets a previously magic-link-only candidate attach a password to the same account', async () => {
    const email = uniqueEmail();
    const token = await requestMagicLinkToken(email);
    const verifyRes = await server().get(`/auth/verify?token=${token}`).expect(200);
    const magicLinkCookies = verifyRes.headers['set-cookie'] as unknown as string[];
    const magicLinkSessionCookie = magicLinkCookies.find((c) => c.startsWith('candidate_session='));
    const jwt = magicLinkSessionCookie?.split(';')[0].split('=')[1] ?? '';
    const candidateIdFromMagicLink = (
      JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()) as { candidateId: string }
    ).candidateId;

    const registerRes = await server()
      .post('/auth/register')
      .send({ email, password: 'a-strong-password' })
      .expect(201);
    const registerCookies = registerRes.headers['set-cookie'] as unknown as string[];
    const registerSessionCookie = registerCookies.find((c) => c.startsWith('candidate_session='));
    const registerJwt = registerSessionCookie?.split(';')[0].split('=')[1] ?? '';
    const candidateIdFromRegister = (
      JSON.parse(Buffer.from(registerJwt.split('.')[1], 'base64').toString()) as { candidateId: string }
    ).candidateId;

    expect(candidateIdFromRegister).toBe(candidateIdFromMagicLink);
  }, 15000);
});

// GitHub issue #681 (Phase 48, D104) — password login, against real Postgres.
describe('Candidate password login (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await bootApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function register(email: string, password: string): Promise<void> {
    await server().post('/auth/register').send({ email, password }).expect(201);
  }

  async function requestMagicLinkToken(email: string): Promise<string> {
    await server().post('/auth/request-link').send({ email }).expect(200);
    const message = await waitForMailpitMessage(email);
    const full = await getMailpitMessage(message.ID);
    const token = /token=([0-9a-f]{64})/.exec(full.Text)?.[1];
    if (!token) throw new Error(`No token found in the email sent to ${email}`);
    return token;
  }

  it('logs in with the correct password and starts a session', async () => {
    const email = uniqueEmail();
    await register(email, 'a-strong-password');

    const res = await server().post('/auth/login').send({ email, password: 'a-strong-password' }).expect(200);
    expect(body<StatusBody>(res)).toEqual({ status: 'ok' });

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((c) => c.startsWith('candidate_session='));
    expect(sessionCookie).toBeDefined();

    const meRes = await server().get('/auth/me').set('Cookie', sessionCookie ?? '').expect(200);
    expect(typeof body<{ candidateId: string }>(meRes).candidateId).toBe('string');
  }, 15000);

  it('rejects an incorrect password with 401', async () => {
    const email = uniqueEmail();
    await register(email, 'a-strong-password');

    await server().post('/auth/login').send({ email, password: 'wrong-password' }).expect(401);
  }, 15000);

  it('rejects an unknown email with 401', async () => {
    await server().post('/auth/login').send({ email: uniqueEmail(), password: 'whatever' }).expect(401);
  });

  it('rejects a magic-link-only candidate who has never set a password', async () => {
    const email = uniqueEmail();
    const token = await requestMagicLinkToken(email);
    await server().get(`/auth/verify?token=${token}`).expect(200);

    await server().post('/auth/login').send({ email, password: 'whatever' }).expect(401);
  }, 15000);

  it('rate-limits the login endpoint after repeated attempts', async () => {
    const email = uniqueEmail();
    await register(email, 'a-strong-password');

    for (let i = 0; i < 5; i++) {
      await server().post('/auth/login').send({ email, password: 'wrong-password' }).expect(401);
    }
    await server().post('/auth/login').send({ email, password: 'a-strong-password' }).expect(429);
  }, 20000);
});

// GitHub issue #682 (Phase 48, D104) — forgot-password flow, against real
// Postgres + Mailpit.
describe('Candidate password reset (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await bootApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function register(email: string, password: string): Promise<void> {
    await server().post('/auth/register').send({ email, password }).expect(201);
  }

  async function requestResetToken(email: string): Promise<string> {
    await server().post('/auth/request-password-reset').send({ email }).expect(200);
    const message = await waitForMailpitMessage(email);
    const full = await getMailpitMessage(message.ID);
    const token = /token=([0-9a-f]{64})/.exec(full.Text)?.[1];
    if (!token) throw new Error(`No password reset token found in the email sent to ${email}`);
    return token;
  }

  it('request-password-reset always returns the same shape, whether or not the email is known', async () => {
    const res = await server().post('/auth/request-password-reset').send({ email: uniqueEmail() }).expect(200);
    expect(body<StatusBody>(res)).toEqual({ status: 'ok' });
  });

  it('resetting the password starts a session, and the old password no longer works', async () => {
    const email = uniqueEmail();
    await register(email, 'the-original-password');
    const token = await requestResetToken(email);

    const confirmRes = await server()
      .post('/auth/confirm-password-reset')
      .send({ token, newPassword: 'a-brand-new-password' })
      .expect(200);
    expect(body<StatusBody>(confirmRes)).toEqual({ status: 'ok' });
    const cookies = confirmRes.headers['set-cookie'] as unknown as string[];
    expect(cookies.find((c) => c.startsWith('candidate_session='))).toBeDefined();

    await server().post('/auth/login').send({ email, password: 'the-original-password' }).expect(401);
    await server().post('/auth/login').send({ email, password: 'a-brand-new-password' }).expect(200);
  }, 15000);

  it('invalidates the session that was active before the reset', async () => {
    const email = uniqueEmail();
    await register(email, 'the-original-password');
    const loginRes = await server()
      .post('/auth/login')
      .send({ email, password: 'the-original-password' })
      .expect(200);
    const oldCookies = loginRes.headers['set-cookie'] as unknown as string[];
    const oldSessionCookie = oldCookies.find((c) => c.startsWith('candidate_session='));

    const token = await requestResetToken(email);
    await server().post('/auth/confirm-password-reset').send({ token, newPassword: 'a-brand-new-password' }).expect(200);

    await server().get('/auth/me').set('Cookie', oldSessionCookie ?? '').expect(401);
  }, 15000);

  it('rejects reusing an already-consumed reset token', async () => {
    const email = uniqueEmail();
    await register(email, 'the-original-password');
    const token = await requestResetToken(email);

    await server().post('/auth/confirm-password-reset').send({ token, newPassword: 'a-brand-new-password' }).expect(200);
    await server().post('/auth/confirm-password-reset').send({ token, newPassword: 'yet-another-password' }).expect(409);
  }, 15000);

  it('rejects an unknown token', async () => {
    await server()
      .post('/auth/confirm-password-reset')
      .send({ token: 'a'.repeat(64), newPassword: 'a-brand-new-password' })
      .expect(404);
  });

  it('rate-limits the request-password-reset endpoint after repeated attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await server().post('/auth/request-password-reset').send({ email: uniqueEmail() }).expect(200);
    }
    await server().post('/auth/request-password-reset').send({ email: uniqueEmail() }).expect(429);
  }, 20000);
});
