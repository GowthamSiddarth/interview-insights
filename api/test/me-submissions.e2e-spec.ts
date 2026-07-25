import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
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
interface QueueEntryBody {
  id: string;
  entityId: string;
}
interface MySubmissionsEntry {
  processId: string;
  companyId: string;
  roleTitle: string;
  roundRatings: Array<{ id: string; status: string; roundTitle: string }>;
  recruiterRatings: Array<{ id: string; status: string }>;
  overallReview: { id: string; status: string } | null;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Proves GitHub issue #149's acceptance criteria against real Postgres:
// GET /me/submissions returns only the session candidate's own rows,
// every moderation status is visible to its owner (unlike every public
// read path, which only ever surfaces approved), grouped by
// InterviewProcess (decided during the Phase 17 kickoff brainstorm) —
// and 401s unauthenticated.
describe('My submissions (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  beforeEach(async () => {
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
    adminCookie = await loginAsAdmin(app);
  });

  afterEach(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  async function findQueueEntryFor(entityId: string): Promise<QueueEntryBody> {
    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = body<QueueEntryBody[]>(queueRes).find((e) => e.entityId === entityId);
    if (!entry) throw new Error(`No moderation_queue entry found for entity ${entityId}`);
    return entry;
  }

  async function approve(entityId: string): Promise<void> {
    const entry = await findQueueEntryFor(entityId);
    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
  }

  async function reject(entityId: string): Promise<void> {
    const entry = await findQueueEntryFor(entityId);
    await server()
      .post(`/moderation/queue/${entry.id}/reject`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
  }

  it('rejects an unauthenticated request', async () => {
    await server().get('/me/submissions').expect(401);
  });

  it('returns an empty array for a candidate with no submissions', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

    const res = await server().get('/me/submissions').set('Cookie', cookie).expect(200);
    expect(body<MySubmissionsEntry[]>(res)).toEqual([]);
  }, 15000);

  it('groups a full submission (round rating, recruiter rating, overall review) under its process, with every status visible to the owner', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

    const companyRes = await server()
      .post('/companies')
      .set('Cookie', cookie)
      .send({ name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid' })
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

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({ difficulty: 3, fluency: 4, clarity: 5, focus: 4 })
      .expect(201);
    const ratingId = body<{ id: string }>(ratingRes).id;

    const interactionRes = await server()
      .post(`/processes/${processId}/recruiter-interactions`)
      .send({ recruiterIdentifier: `recruiter-${unique()}@example.com` })
      .expect(201);
    const interactionId = body<InteractionBody>(interactionRes).id;

    const recruiterRatingRes = await server()
      .post(`/recruiter-interactions/${interactionId}/ratings`)
      .set('Cookie', cookie)
      .send({ approachability: 5, responseTime: 4, timeliness: 5, communicationQuality: 5 })
      .expect(201);
    const recruiterRatingId = body<{ id: string }>(recruiterRatingRes).id;

    const overallReviewRes = await server()
      .post(`/processes/${processId}/overall-review`)
      .set('Cookie', cookie)
      .send({ overallExperience: 4, wouldRecommend: true })
      .expect(201);
    const overallReviewId = body<{ id: string }>(overallReviewRes).id;

    // Approve the round rating, reject the recruiter rating — both
    // statuses must still show up, since this is the owner's own view.
    await approve(ratingId);
    await reject(recruiterRatingId);
    // Overall review stays pending, untouched.

    const res = await server().get('/me/submissions').set('Cookie', cookie).expect(200);
    const entries = body<MySubmissionsEntry[]>(res);

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.processId).toBe(processId);
    expect(entry.companyId).toBe(companyId);
    expect(entry.roleTitle).toBe('Senior Backend Engineer');

    expect(entry.roundRatings).toHaveLength(1);
    expect(entry.roundRatings[0]).toMatchObject({
      id: ratingId,
      status: 'approved',
      roundTitle: 'Technical Screen',
    });

    expect(entry.recruiterRatings).toHaveLength(1);
    expect(entry.recruiterRatings[0]).toMatchObject({ id: recruiterRatingId, status: 'rejected' });

    expect(entry.overallReview).toMatchObject({ id: overallReviewId, status: 'pending' });
  }, 20000);

  it("never surfaces another candidate's submissions", async () => {
    const candidateA = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const candidateB = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

    const companyRes = await server()
      .post('/companies')
      .set('Cookie', candidateA.cookie)
      .send({ name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', candidateA.cookie)
      .send({ roleTitle: 'Engineer A', outcome: 'in_progress' })
      .expect(201);

    const resB = await server().get('/me/submissions').set('Cookie', candidateB.cookie).expect(200);
    expect(body<MySubmissionsEntry[]>(resB)).toEqual([]);
  }, 15000);

  it('includes a process with no ratings yet, with empty nested arrays', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

    const companyRes = await server()
      .post('/companies')
      .set('Cookie', cookie)
      .send({ name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Engineer', outcome: 'in_progress' })
      .expect(201);

    const res = await server().get('/me/submissions').set('Cookie', cookie).expect(200);
    const entries = body<MySubmissionsEntry[]>(res);

    expect(entries).toHaveLength(1);
    expect(entries[0].roundRatings).toEqual([]);
    expect(entries[0].recruiterRatings).toEqual([]);
    expect(entries[0].overallReview).toBeNull();
  }, 15000);
});
