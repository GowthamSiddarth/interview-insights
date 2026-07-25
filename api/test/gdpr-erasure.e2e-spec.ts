import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
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
interface RatingBody {
  id: string;
}
interface QueueEntryBody {
  id: string;
  entityId: string;
}
interface ReviewSearchResultBody {
  id: string;
}
interface MySubmissionsEntry {
  recruiterRatings: Array<{ id: string }>;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Direct Postgres client — the same pattern aggregation-views.e2e-spec.ts
// uses to inspect rows and refresh materialized views outside the
// NestJS/Prisma-service layer the app itself uses.
const rawPrisma = new PrismaClient();

// Proves GitHub issue #151's acceptance criteria against real Postgres +
// OpenSearch: a full erasure leaves zero rows referencing the candidate
// across every table and both search indices, and the materialized views
// converge on the next refresh; a stale post-erasure session gets a clean
// 401, not a downstream error; and another candidate's RecruiterInteraction/
// rating sharing the same company's Recruiter row is unaffected.
describe('GDPR erasure (e2e)', () => {
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

  afterAll(async () => {
    await rawPrisma.$disconnect();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  async function createCompany(cookie: string): Promise<string> {
    const res = await server()
      .post('/companies')
      .set('Cookie', cookie)
      .send({ name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid' })
      .expect(201);
    return body<CompanyBody>(res).id;
  }

  async function approve(entityId: string): Promise<void> {
    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = body<QueueEntryBody[]>(queueRes).find((e) => e.entityId === entityId);
    if (!entry) throw new Error(`No moderation_queue entry found for entity ${entityId}`);
    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
  }

  async function refreshRoundTypeView(): Promise<void> {
    await rawPrisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW company_round_type_aggregates');
  }

  it('erases every row referencing the candidate, both search indices, and converges the materialized view', async () => {
    const email = `candidate-${unique()}@example.com`;
    const { cookie, candidateId } = await loginAsCandidate(app, email);
    const companyId = await createCompany(cookie);

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
    const ratingId = body<RatingBody>(ratingRes).id;
    await approve(ratingId);

    const interactionRes = await server()
      .post(`/processes/${processId}/recruiter-interactions`)
      .send({ recruiterIdentifier: `recruiter-${unique()}@example.com` })
      .expect(201);
    const interactionId = body<InteractionBody>(interactionRes).id;

    const recruiterRatingRes = await server()
      .post(`/recruiter-interactions/${interactionId}/ratings`)
      .set('Cookie', cookie)
      .send({ reachability: 4, responsiveness: 3, guidelinesShared: 4 })
      .expect(201);
    const recruiterRatingId = body<RatingBody>(recruiterRatingRes).id;

    const overallReviewRes = await server()
      .post(`/processes/${processId}/overall-review`)
      .set('Cookie', cookie)
      .send({ overallExperience: 4, wouldRecommend: true })
      .expect(201);
    const overallReviewId = body<RatingBody>(overallReviewRes).id;

    // Sanity: the approved rating is searchable and contributes to the
    // materialized view before erasure — proves the "after" state below
    // is a real disappearance, not just "was never there."
    await refreshRoundTypeView();
    const searchBefore = await server().get('/search/reviews').query({ companyId }).expect(200);
    expect(body<ReviewSearchResultBody[]>(searchBefore).map((r) => r.id)).toContain(ratingId);
    const aggregatesBefore = await rawPrisma.$queryRawUnsafe<Array<{ sample_size: number }>>(
      `SELECT sample_size FROM company_round_type_aggregates WHERE company_id = $1::uuid AND round_type = 'coding'`,
      companyId,
    );
    expect(aggregatesBefore).toHaveLength(1);
    expect(Number(aggregatesBefore[0].sample_size)).toBe(1);

    await server().delete('/me').set('Cookie', cookie).expect(204);

    // Every row across every table this candidate touched is gone.
    expect(await rawPrisma.candidate.findUnique({ where: { id: candidateId } })).toBeNull();
    expect(await rawPrisma.roundRating.findUnique({ where: { id: ratingId } })).toBeNull();
    expect(await rawPrisma.recruiterRating.findUnique({ where: { id: recruiterRatingId } })).toBeNull();
    expect(await rawPrisma.overallReview.findUnique({ where: { id: overallReviewId } })).toBeNull();
    expect(await rawPrisma.interviewProcess.findUnique({ where: { id: processId } })).toBeNull();
    expect(await rawPrisma.round.findUnique({ where: { id: roundId } })).toBeNull();
    expect(await rawPrisma.recruiterInteraction.findUnique({ where: { id: interactionId } })).toBeNull();
    const remainingQueueEntries = await rawPrisma.moderationQueueEntry.findMany({
      where: { entityId: { in: [ratingId, recruiterRatingId, overallReviewId] } },
    });
    expect(remainingQueueEntries).toEqual([]);
    const remainingTokens = await rawPrisma.candidateVerificationToken.findMany({
      where: { candidateId },
    });
    expect(remainingTokens).toEqual([]);

    // The OpenSearch reviews doc is gone.
    const searchAfter = await server().get('/search/reviews').query({ companyId }).expect(200);
    expect(body<ReviewSearchResultBody[]>(searchAfter)).toEqual([]);

    // The materialized view converges to zero rows for this company/round
    // type on the next refresh — same "zero-approved-group produces no
    // row at all" behavior issue #7's own tests already established.
    await refreshRoundTypeView();
    const aggregatesAfter = await rawPrisma.$queryRawUnsafe<Array<{ sample_size: number }>>(
      `SELECT sample_size FROM company_round_type_aggregates WHERE company_id = $1::uuid AND round_type = 'coding'`,
      companyId,
    );
    expect(aggregatesAfter).toEqual([]);
  }, 30000);

  it('a stale session surviving after erasure gets a clean 401, not a downstream error', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

    await server().delete('/me').set('Cookie', cookie).expect(204);

    await server().get('/me/submissions').set('Cookie', cookie).expect(401);
  }, 15000);

  it('erasing one candidate never touches another candidate sharing the same company Recruiter row', async () => {
    const candidateA = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const companyId = await createCompany(candidateA.cookie);
    const sharedIdentifier = `recruiter-${unique()}@example.com`;

    const processA = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', candidateA.cookie)
      .send({ roleTitle: 'Engineer A', outcome: 'in_progress' })
      .expect(201);
    const processIdA = body<ProcessBody>(processA).id;
    const interactionA = await server()
      .post(`/processes/${processIdA}/recruiter-interactions`)
      .send({ recruiterIdentifier: sharedIdentifier })
      .expect(201);
    const interactionIdA = body<InteractionBody>(interactionA).id;
    await server()
      .post(`/recruiter-interactions/${interactionIdA}/ratings`)
      .set('Cookie', candidateA.cookie)
      .send({ reachability: 5, responsiveness: 5, guidelinesShared: 5 })
      .expect(201);

    const candidateB = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const processB = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', candidateB.cookie)
      .send({ roleTitle: 'Engineer B', outcome: 'in_progress' })
      .expect(201);
    const processIdB = body<ProcessBody>(processB).id;
    const interactionB = await server()
      .post(`/processes/${processIdB}/recruiter-interactions`)
      .send({ recruiterIdentifier: sharedIdentifier })
      .expect(201);
    const interactionIdB = body<InteractionBody>(interactionB).id;
    const ratingB = await server()
      .post(`/recruiter-interactions/${interactionIdB}/ratings`)
      .set('Cookie', candidateB.cookie)
      .send({ reachability: 4, responsiveness: 4, guidelinesShared: 4 })
      .expect(201);
    const ratingIdB = body<RatingBody>(ratingB).id;

    // Same identifier + same company resolves to the same shared
    // Recruiter row (RecruitersService.findOrCreate's upsert).
    const interactionRowA = await rawPrisma.recruiterInteraction.findUniqueOrThrow({
      where: { id: interactionIdA },
    });
    const interactionRowB = await rawPrisma.recruiterInteraction.findUniqueOrThrow({
      where: { id: interactionIdB },
    });
    expect(interactionRowA.recruiterId).toBe(interactionRowB.recruiterId);
    const sharedRecruiterId = interactionRowA.recruiterId;

    await server().delete('/me').set('Cookie', candidateA.cookie).expect(204);

    // Candidate A's own interaction is gone, but the shared Recruiter row
    // and candidate B's interaction/rating survive untouched.
    expect(
      await rawPrisma.recruiterInteraction.findUnique({ where: { id: interactionIdA } }),
    ).toBeNull();
    expect(await rawPrisma.recruiter.findUnique({ where: { id: sharedRecruiterId } })).not.toBeNull();
    expect(
      await rawPrisma.recruiterInteraction.findUnique({ where: { id: interactionIdB } }),
    ).not.toBeNull();
    expect(await rawPrisma.recruiterRating.findUnique({ where: { id: ratingIdB } })).not.toBeNull();

    const resB = await server().get('/me/submissions').set('Cookie', candidateB.cookie).expect(200);
    const entriesB = body<MySubmissionsEntry[]>(resB);
    expect(entriesB.some((entry) => entry.recruiterRatings.some((r) => r.id === ratingIdB))).toBe(true);
  }, 30000);
});
