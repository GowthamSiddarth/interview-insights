import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';

interface CandidateBody {
  id: string;
  verificationStatus: string;
  verifiedAt: string | null;
}
interface TokenBody {
  token: string;
  expiresAt: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Proves the email-verification flow from docs/ROADMAP.md Phase 3 issue #3
// closes end to end against a real Postgres: a new candidate starts
// unverified, issuing + consuming a token flips them to email_verified, and
// the token can't be reused or reused past expiry/consumption.
describe('Candidate verification (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new PrismaExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function createCandidate(): Promise<string> {
    const res = await server().post('/candidates').send({ email: uniqueEmail() }).expect(200);
    return body<CandidateBody>(res).id;
  }

  it('new candidates start unverified', async () => {
    const candidateId = await createCandidate();

    const res = await server().get(`/candidates/${candidateId}`).expect(200);
    expect(body<CandidateBody>(res).verificationStatus).toBe('unverified');
  });

  it('issuing and verifying a token flips the candidate to email_verified', async () => {
    const candidateId = await createCandidate();

    const tokenRes = await server()
      .post(`/candidates/${candidateId}/verification-token`)
      .expect(201);
    const { token } = body<TokenBody>(tokenRes);
    expect(token).toHaveLength(64);

    const verifyRes = await server().post('/candidates/verify').send({ token }).expect(201);
    const verified = body<CandidateBody>(verifyRes);
    expect(verified.id).toBe(candidateId);
    expect(verified.verificationStatus).toBe('email_verified');
    expect(verified.verifiedAt).not.toBeNull();

    const fetched = await server().get(`/candidates/${candidateId}`).expect(200);
    expect(body<CandidateBody>(fetched).verificationStatus).toBe('email_verified');
  });

  it('rejects reusing an already-consumed token', async () => {
    const candidateId = await createCandidate();
    const tokenRes = await server()
      .post(`/candidates/${candidateId}/verification-token`)
      .expect(201);
    const { token } = body<TokenBody>(tokenRes);

    await server().post('/candidates/verify').send({ token }).expect(201);
    await server().post('/candidates/verify').send({ token }).expect(409);
  });

  it('rejects an unknown token', async () => {
    await server()
      .post('/candidates/verify')
      .send({ token: 'a'.repeat(64) })
      .expect(404);
  });

  it('issuing a new token supersedes the previous one for that candidate', async () => {
    const candidateId = await createCandidate();

    const firstTokenRes = await server()
      .post(`/candidates/${candidateId}/verification-token`)
      .expect(201);
    const { token: firstToken } = body<TokenBody>(firstTokenRes);

    await server().post(`/candidates/${candidateId}/verification-token`).expect(201);

    // The first token was superseded, not just left dangling — attempting
    // to verify with it should behave like an already-used token.
    await server().post('/candidates/verify').send({ token: firstToken }).expect(409);
  });
});
