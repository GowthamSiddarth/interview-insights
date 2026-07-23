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

  async function candidateIdFor(email: string): Promise<string> {
    // POST /candidates upserts by email — same candidate row request-link
    // already created, just resolving its id for assertions.
    const res = await server().post('/candidates').send({ email }).expect(200);
    return body<CandidateBody>(res).id;
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

  it('first login flips verificationStatus to email_verified', async () => {
    const email = uniqueEmail();
    const token = await requestMagicLinkToken(email);
    const candidateId = await candidateIdFor(email);

    const before = await server().get(`/candidates/${candidateId}`).expect(200);
    expect(body<CandidateBody>(before).verificationStatus).toBe('unverified');

    await server().get(`/auth/verify?token=${token}`).expect(200);

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
});
