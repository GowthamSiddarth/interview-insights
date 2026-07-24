import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { assertUsingTestDatabase } from './support/assert-test-database';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';

const rawPrisma = new PrismaClient();
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function body<T>(res: request.Response): T {
  return res.body as T;
}

interface CompanyBody {
  id: string;
}
interface ProcessBody {
  id: string;
}
interface RoundBody {
  id: string;
}
interface RatingBody {
  id: string;
  status: string;
}
interface InteractionBody {
  id: string;
}
interface QueueEntryBody {
  id: string;
  entityType: string;
  entityId: string;
  reviewedAt: string | null;
}
interface ReviewSearchResultBody {
  id: string;
}
interface CompanyAnalyticsBody {
  roundTypes: Array<{
    roundType: string;
    sampleSize: number;
    scores: Record<string, number | null>;
  }>;
}
interface MySubmissionsEntry {
  processId: string;
  roundRatings: Array<{ id: string; status: string }>;
  recruiterRatings: Array<{ id: string; status: string }>;
  overallReview: { id: string; status: string } | null;
}

// A single continuous walkthrough of every feature built across Phases
// 1-18 — company creation, candidate magic-link auth, all three moderated
// content types, moderation approve/reject, search, analytics (clearing
// the n=3 shrinkage floor for a real, non-null score), my-reviews,
// update/delete (issue #150), and GDPR erasure (issue #151) — proving the
// whole system works together, not just each piece in isolation.
//
// Opt-in only (`npm run smoke:e2e`) — deliberately never part of
// `npm run test:e2e`/CI. The 105+ per-feature e2e specs already own
// regression coverage; this is a manual "did I break the golden path"
// sanity check, safe to rerun on demand because assertUsingTestDatabase()
// refuses to run against anything but interview_insights_test — see
// docs/DECISIONS.md D36 for why this exists.
//
// Deliberately ONE shared app instance for the whole file, unlike every
// other e2e spec's fresh-app-per-test pattern: this describes a single
// continuous narrative, not many independent tests, and only 3 logins
// happen in total (2 candidates + 1 admin) — nowhere near the
// 5-per-window magic-link/login throttles that made per-test isolation
// necessary elsewhere.
describe('Full golden path (e2e smoke test)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let candidateA: { cookie: string; candidateId: string };
  let candidateB: { cookie: string; candidateId: string };
  let companyId: string;
  let processIdA: string;
  const roundIds: string[] = [];
  const roundRatingIds: string[] = [];
  let recruiterInteractionIdA: string;
  let recruiterRatingId: string;
  let overallReviewId: string;
  let interactionIdB: string;
  let recruiterRatingIdB: string;
  const sharedRecruiterIdentifier = `recruiter-${unique()}@example.com`;

  beforeAll(async () => {
    assertUsingTestDatabase();

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
    candidateA = await loginAsCandidate(app, `golden-path-a-${unique()}@example.com`);
    candidateB = await loginAsCandidate(app, `golden-path-b-${unique()}@example.com`);
  }, 30000);

  afterAll(async () => {
    await app.close();
    await rawPrisma.$disconnect();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  async function findQueueEntryFor(entityId: string): Promise<QueueEntryBody> {
    const res = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = body<QueueEntryBody[]>(res).find((e) => e.entityId === entityId);
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

  it('1. creates a company', async () => {
    const res = await server()
      .post('/companies')
      .send({ name: 'Golden Path Corp', slug: `golden-path-${unique()}`, sizeBucket: 'mid' })
      .expect(201);
    companyId = body<CompanyBody>(res).id;
  });

  it('2. creates an interview process for candidate A', async () => {
    const res = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', candidateA.cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    processIdA = body<ProcessBody>(res).id;
  });

  it('3. submits three approved round ratings of the same type — clears the n=3 shrinkage floor', async () => {
    for (let i = 0; i < 3; i++) {
      const roundRes = await server()
        .post(`/processes/${processIdA}/rounds`)
        .send({ sequenceNumber: i + 1, title: `Technical Round ${i + 1}`, roundType: 'coding' })
        .expect(201);
      const roundId = body<RoundBody>(roundRes).id;
      roundIds.push(roundId);

      const ratingRes = await server()
        .post(`/rounds/${roundId}/ratings`)
        .set('Cookie', candidateA.cookie)
        .send({ difficulty: 3, fairness: 4, communicationFluency: 4, attentiveness: 4, biasSignal: 5 })
        .expect(201);
      roundRatingIds.push(body<RatingBody>(ratingRes).id);
    }
    expect(roundRatingIds).toHaveLength(3);
  }, 20000);

  it('4. submits a recruiter interaction + rating for candidate A', async () => {
    const interactionRes = await server()
      .post(`/processes/${processIdA}/recruiter-interactions`)
      .send({ recruiterIdentifier: sharedRecruiterIdentifier })
      .expect(201);
    recruiterInteractionIdA = body<InteractionBody>(interactionRes).id;

    const ratingRes = await server()
      .post(`/recruiter-interactions/${recruiterInteractionIdA}/ratings`)
      .set('Cookie', candidateA.cookie)
      .send({ approachability: 4, responseTime: 3, timeliness: 5, communicationQuality: 4 })
      .expect(201);
    recruiterRatingId = body<RatingBody>(ratingRes).id;
  });

  it('5. submits an overall review for candidate A', async () => {
    const res = await server()
      .post(`/processes/${processIdA}/overall-review`)
      .set('Cookie', candidateA.cookie)
      .send({ overallExperience: 4, wouldRecommend: true })
      .expect(201);
    overallReviewId = body<RatingBody>(res).id;
  });

  it('6. moderation approves all three round ratings, rejects the recruiter rating, leaves the overall review pending', async () => {
    for (const id of roundRatingIds) {
      await approve(id);
    }
    await reject(recruiterRatingId);
    // overallReviewId stays pending — untouched.

    const entry = await findQueueEntryFor(overallReviewId);
    expect(entry.reviewedAt).toBeNull();
  }, 20000);

  it('7. the approved round ratings are searchable', async () => {
    const res = await server().get('/search/reviews').query({ companyId }).expect(200);
    const results = body<ReviewSearchResultBody[]>(res);
    expect(roundRatingIds.every((id) => results.some((r) => r.id === id))).toBe(true);
  });

  it('8. analytics returns a real, non-null shrinkage-scored number once the view refreshes', async () => {
    await rawPrisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW company_round_type_aggregates');

    const res = await server().get(`/companies/${companyId}/analytics`).expect(200);
    const analytics = body<CompanyAnalyticsBody>(res);
    const coding = analytics.roundTypes.find((r) => r.roundType === 'coding');

    expect(coding).toBeDefined();
    expect(coding?.sampleSize).toBe(3);
    expect(coding?.scores.difficulty).not.toBeNull();
  });

  it('9. my-reviews shows all four submissions grouped under the one process, with real statuses', async () => {
    const res = await server().get('/me/submissions').set('Cookie', candidateA.cookie).expect(200);
    const entries = body<MySubmissionsEntry[]>(res);
    const entry = entries.find((e) => e.processId === processIdA);

    expect(entry).toBeDefined();
    expect(entry?.roundRatings.filter((r) => r.status === 'approved')).toHaveLength(3);
    expect(entry?.recruiterRatings[0]?.status).toBe('rejected');
    expect(entry?.overallReview?.status).toBe('pending');
  });

  it('10. editing a round rating resets it to pending and supersedes the reviewed queue entry', async () => {
    const [firstRatingId] = roundRatingIds;
    const [firstRoundId] = roundIds;

    const editRes = await server()
      .patch(`/rounds/${firstRoundId}/ratings/${firstRatingId}`)
      .set('Cookie', candidateA.cookie)
      .send({ difficulty: 5, fairness: 4, communicationFluency: 4, attentiveness: 4, biasSignal: 5 })
      .expect(200);
    expect(body<RatingBody>(editRes).status).toBe('pending');

    const entry = await findQueueEntryFor(firstRatingId);
    expect(entry.reviewedAt).toBeNull();
  });

  it('11. deleting the overall review removes it and its moderation_queue entry', async () => {
    await server()
      .delete(`/processes/${processIdA}/overall-review`)
      .set('Cookie', candidateA.cookie)
      .expect(204);

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    expect(body<QueueEntryBody[]>(queueRes).some((e) => e.entityId === overallReviewId)).toBe(false);
  });

  it('12. candidate B resolves the same shared Recruiter row via the same identifier', async () => {
    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', candidateB.cookie)
      .send({ roleTitle: 'Staff Engineer', outcome: 'in_progress' })
      .expect(201);
    const processIdB = body<ProcessBody>(processRes).id;

    const interactionRes = await server()
      .post(`/processes/${processIdB}/recruiter-interactions`)
      .send({ recruiterIdentifier: sharedRecruiterIdentifier })
      .expect(201);
    interactionIdB = body<InteractionBody>(interactionRes).id;

    const ratingRes = await server()
      .post(`/recruiter-interactions/${interactionIdB}/ratings`)
      .set('Cookie', candidateB.cookie)
      .send({ approachability: 5, responseTime: 5, timeliness: 5, communicationQuality: 5 })
      .expect(201);
    recruiterRatingIdB = body<RatingBody>(ratingRes).id;

    const [interactionRowA, interactionRowB] = await Promise.all([
      rawPrisma.recruiterInteraction.findUniqueOrThrow({ where: { id: recruiterInteractionIdA } }),
      rawPrisma.recruiterInteraction.findUniqueOrThrow({ where: { id: interactionIdB } }),
    ]);
    expect(interactionRowA.recruiterId).toBe(interactionRowB.recruiterId);
  });

  it('13. erasing candidate A removes every row they touched, leaves candidate B and the shared Recruiter row untouched, and a stale session 401s', async () => {
    await server().delete('/me').set('Cookie', candidateA.cookie).expect(204);

    // Candidate A: gone, everywhere.
    expect(await rawPrisma.candidate.findUnique({ where: { id: candidateA.candidateId } })).toBeNull();
    expect(await rawPrisma.interviewProcess.findUnique({ where: { id: processIdA } })).toBeNull();
    for (const id of roundIds) {
      expect(await rawPrisma.round.findUnique({ where: { id } })).toBeNull();
    }
    for (const id of roundRatingIds) {
      expect(await rawPrisma.roundRating.findUnique({ where: { id } })).toBeNull();
    }
    expect(await rawPrisma.recruiterRating.findUnique({ where: { id: recruiterRatingId } })).toBeNull();
    expect(
      await rawPrisma.recruiterInteraction.findUnique({ where: { id: recruiterInteractionIdA } }),
    ).toBeNull();

    // Candidate B and the shared Recruiter row: untouched.
    expect(
      await rawPrisma.recruiterInteraction.findUnique({ where: { id: interactionIdB } }),
    ).not.toBeNull();
    expect(await rawPrisma.recruiterRating.findUnique({ where: { id: recruiterRatingIdB } })).not.toBeNull();

    // A stale session, replayed after erasure, gets a clean 401.
    await server().get('/me/submissions').set('Cookie', candidateA.cookie).expect(401);
  }, 20000);
});
