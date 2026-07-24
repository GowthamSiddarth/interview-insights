import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsCandidate } from './support/candidate-session';

interface CompanyBody {
  id: string;
}
interface ProcessBody {
  id: string;
}
interface RoundBody {
  id: string;
}
interface InteractionBody {
  id: string;
}
interface EntityWithCandidateId {
  candidateId: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Proves GitHub issue #146's core acceptance criteria directly, across
// all four candidateId-bearing write paths (InterviewProcess, RoundRating,
// RecruiterRating, OverallReview) — each existing feature e2e spec was
// already updated to authenticate as part of this same issue, but this
// file is the single place asserting the guarantee itself: unauthenticated
// writes 401, and a candidate can never write as another (candidateId
// only ever comes from the session, never the request body).
describe('Sessions on the write path (e2e)', () => {
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
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueSlug = () => `acme-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function setUpProcessAndRound(cookie: string): Promise<{ processId: string; roundId: string }> {
    const companyRes = await server()
      .post('/companies')
      .send({ name: 'Acme Corp', slug: uniqueSlug(), sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    return { processId, roundId };
  }

  describe('unauthenticated requests get 401', () => {
    it('POST /companies/:companyId/processes', async () => {
      const companyRes = await server()
        .post('/companies')
        .send({ name: 'Acme Corp', slug: uniqueSlug(), sizeBucket: 'mid' })
        .expect(201);
      const companyId = body<CompanyBody>(companyRes).id;

      await server()
        .post(`/companies/${companyId}/processes`)
        .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
        .expect(401);
    });

    it('POST /rounds/:roundId/ratings', async () => {
      const { cookie } = await loginAsCandidate(app, uniqueEmail());
      const { roundId } = await setUpProcessAndRound(cookie);

      await server()
        .post(`/rounds/${roundId}/ratings`)
        .send({ difficulty: 3, fairness: 4, communicationFluency: 5, attentiveness: 4, biasSignal: 5 })
        .expect(401);
    }, 15000);

    it('POST /recruiter-interactions/:id/ratings', async () => {
      const { cookie } = await loginAsCandidate(app, uniqueEmail());
      const { processId } = await setUpProcessAndRound(cookie);

      const interactionRes = await server()
        .post(`/processes/${processId}/recruiter-interactions`)
        .send({ recruiterIdentifier: `recruiter-${Date.now()}@example.com` })
        .expect(201);
      const interactionId = body<InteractionBody>(interactionRes).id;

      await server()
        .post(`/recruiter-interactions/${interactionId}/ratings`)
        .send({ approachability: 4, responseTime: 3, timeliness: 5, communicationQuality: 4 })
        .expect(401);
    }, 15000);

    it('POST /processes/:processId/overall-review', async () => {
      const { cookie } = await loginAsCandidate(app, uniqueEmail());
      const { processId } = await setUpProcessAndRound(cookie);

      await server()
        .post(`/processes/${processId}/overall-review`)
        .send({ overallExperience: 4, wouldRecommend: true })
        .expect(401);
    }, 15000);
  });

  describe('a candidate cannot write as another', () => {
    it('a client-supplied candidateId in the body is rejected outright (unrecognized property), never used', async () => {
      const { cookie, candidateId: ownCandidateId } = await loginAsCandidate(app, uniqueEmail());
      const { roundId } = await setUpProcessAndRound(cookie);

      // Whitelist validation (main.ts's global ValidationPipe,
      // forbidNonWhitelisted: true) rejects the extra field outright —
      // candidateId isn't declared on CreateRoundRatingDto anymore, so
      // there's no code path where a supplied value could be used even
      // accidentally.
      await server()
        .post(`/rounds/${roundId}/ratings`)
        .set('Cookie', cookie)
        .send({
          candidateId: 'not-my-candidate-id',
          difficulty: 3,
          fairness: 4,
          communicationFluency: 5,
          attentiveness: 4,
          biasSignal: 5,
        })
        .expect(400);

      // The legitimate write (no injected field) attributes to the
      // session's own candidate — the create response echoes the row
      // back to the submitter (not a public read, so this isn't the
      // hard-constraint candidateId leak; the submitter obviously
      // already knows their own id).
      const ratingRes = await server()
        .post(`/rounds/${roundId}/ratings`)
        .set('Cookie', cookie)
        .send({ difficulty: 3, fairness: 4, communicationFluency: 5, attentiveness: 4, biasSignal: 5 })
        .expect(201);
      expect(body<EntityWithCandidateId>(ratingRes).candidateId).toBe(ownCandidateId);
    }, 15000);
  });
});
