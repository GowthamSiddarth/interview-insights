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
interface RatingBody {
  id: string;
  status: string;
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

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const roundRatingPayload = {
  difficulty: 3,
  fluency: 4,
  clarity: 5,
  focus: 4,
};
const recruiterRatingPayload = {
  reachability: 4,
  responsiveness: 3,
  guidelinesShared: 5,
};
const overallReviewPayload = { overallExperience: 4, wouldRecommend: true };

// Proves GitHub issue #150's acceptance criteria against real Postgres +
// OpenSearch: owner-only update/delete (403 for anyone else) across all
// three moderated content types; an edit never modifies public content in
// place, it resets to `pending` and gets a fresh (superseding) moderation
// queue entry; delete removes the moderation_queue entry and, for an
// approved round rating, the OpenSearch document too; and the per-candidate
// edit throttle trips after repeated edits — all decided during the Phase
// 17 kickoff brainstorm, never in the original issue text.
describe('Update/Delete under moderation-safe rules (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  // Fresh app per test — same reasoning as every other Phase 16+ e2e spec:
  // a shared instance's cumulative /auth/request-link calls would trip the
  // magic-link throttle once several tests each need their own candidate.
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

  async function createCandidateAndProcess(): Promise<{
    cookie: string;
    companyId: string;
    processId: string;
  }> {
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

    return { cookie, companyId, processId };
  }

  async function createRoundRating(): Promise<{
    cookie: string;
    companyId: string;
    roundId: string;
    ratingId: string;
  }> {
    const { cookie, companyId, processId } = await createCandidateAndProcess();

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send(roundRatingPayload)
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    return { cookie, companyId, roundId, ratingId };
  }

  async function createRecruiterRating(): Promise<{
    cookie: string;
    interactionId: string;
    ratingId: string;
  }> {
    const { cookie, processId } = await createCandidateAndProcess();

    const interactionRes = await server()
      .post(`/processes/${processId}/recruiter-interactions`)
      .send({ recruiterIdentifier: `recruiter-${unique()}@example.com` })
      .expect(201);
    const interactionId = body<InteractionBody>(interactionRes).id;

    const ratingRes = await server()
      .post(`/recruiter-interactions/${interactionId}/ratings`)
      .set('Cookie', cookie)
      .send(recruiterRatingPayload)
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    return { cookie, interactionId, ratingId };
  }

  async function createOverallReview(): Promise<{
    cookie: string;
    processId: string;
    reviewId: string;
  }> {
    const { cookie, processId } = await createCandidateAndProcess();

    const reviewRes = await server()
      .post(`/processes/${processId}/overall-review`)
      .set('Cookie', cookie)
      .send(overallReviewPayload)
      .expect(201);
    const reviewId = body<RatingBody>(reviewRes).id;

    return { cookie, processId, reviewId };
  }

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

  describe('round ratings', () => {
    it('rejects an edit from anyone but the owning candidate', async () => {
      const { roundId, ratingId } = await createRoundRating();
      const { cookie: otherCookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

      await server()
        .patch(`/rounds/${roundId}/ratings/${ratingId}`)
        .set('Cookie', otherCookie)
        .send({ ...roundRatingPayload, difficulty: 5 })
        .expect(403);
    }, 20000);

    it('rejects a delete from anyone but the owning candidate', async () => {
      const { roundId, ratingId } = await createRoundRating();
      const { cookie: otherCookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

      await server()
        .delete(`/rounds/${roundId}/ratings/${ratingId}`)
        .set('Cookie', otherCookie)
        .expect(403);
    }, 20000);

    it('an edit after approval resets status to pending and supersedes the reviewed queue entry', async () => {
      const { cookie, roundId, ratingId } = await createRoundRating();
      await approve(ratingId);

      const editRes = await server()
        .patch(`/rounds/${roundId}/ratings/${ratingId}`)
        .set('Cookie', cookie)
        .send({ ...roundRatingPayload, difficulty: 5, freeText: `edited ${unique()}` })
        .expect(200);
      expect(body<RatingBody>(editRes).status).toBe('pending');

      const entry = await findQueueEntryFor(ratingId);
      expect(entry.reviewedAt).toBeNull();
    }, 20000);

    it('an edit before any review supersedes the old unreviewed entry instead of leaving two live entries', async () => {
      const { cookie, roundId, ratingId } = await createRoundRating();

      await server()
        .patch(`/rounds/${roundId}/ratings/${ratingId}`)
        .set('Cookie', cookie)
        .send({ ...roundRatingPayload, difficulty: 2 })
        .expect(200);

      const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
      const entriesForRating = body<QueueEntryBody[]>(queueRes).filter((e) => e.entityId === ratingId);
      expect(entriesForRating).toHaveLength(1);
    }, 20000);

    it('deleting an approved rating removes it from public reads, the queue, and the search index', async () => {
      const { cookie, companyId, roundId, ratingId } = await createRoundRating();
      await approve(ratingId);

      const searchBefore = await server().get('/search/reviews').query({ companyId }).expect(200);
      expect(body<ReviewSearchResultBody[]>(searchBefore).map((r) => r.id)).toContain(ratingId);

      await server()
        .delete(`/rounds/${roundId}/ratings/${ratingId}`)
        .set('Cookie', cookie)
        .expect(204);

      const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
      expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).not.toContain(ratingId);

      const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
      expect(body<QueueEntryBody[]>(queueRes).some((e) => e.entityId === ratingId)).toBe(false);

      const searchAfter = await server().get('/search/reviews').query({ companyId }).expect(200);
      expect(body<ReviewSearchResultBody[]>(searchAfter)).toEqual([]);
    }, 20000);

    it('deleting a still-pending rating removes its moderation_queue entry', async () => {
      const { cookie, roundId, ratingId } = await createRoundRating();

      await server()
        .delete(`/rounds/${roundId}/ratings/${ratingId}`)
        .set('Cookie', cookie)
        .expect(204);

      const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
      expect(body<QueueEntryBody[]>(queueRes).some((e) => e.entityId === ratingId)).toBe(false);
    }, 20000);
  });

  describe('recruiter ratings', () => {
    it('rejects an edit from anyone but the owning candidate', async () => {
      const { interactionId, ratingId } = await createRecruiterRating();
      const { cookie: otherCookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

      await server()
        .patch(`/recruiter-interactions/${interactionId}/ratings/${ratingId}`)
        .set('Cookie', otherCookie)
        .send({ ...recruiterRatingPayload, reachability: 5 })
        .expect(403);
    }, 20000);

    it('an edit resets status to pending and re-enqueues', async () => {
      const { cookie, interactionId, ratingId } = await createRecruiterRating();
      await approve(ratingId);

      const editRes = await server()
        .patch(`/recruiter-interactions/${interactionId}/ratings/${ratingId}`)
        .set('Cookie', cookie)
        .send({ ...recruiterRatingPayload, reachability: 2 })
        .expect(200);
      expect(body<RatingBody>(editRes).status).toBe('pending');

      const entry = await findQueueEntryFor(ratingId);
      expect(entry.reviewedAt).toBeNull();
    }, 20000);

    it('deleting removes the rating and its moderation_queue entry', async () => {
      const { cookie, interactionId, ratingId } = await createRecruiterRating();

      await server()
        .delete(`/recruiter-interactions/${interactionId}/ratings/${ratingId}`)
        .set('Cookie', cookie)
        .expect(204);

      const publicRatings = await server()
        .get(`/recruiter-interactions/${interactionId}/ratings`)
        .expect(200);
      expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).not.toContain(ratingId);

      const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
      expect(body<QueueEntryBody[]>(queueRes).some((e) => e.entityId === ratingId)).toBe(false);
    }, 20000);
  });

  describe('overall review', () => {
    it('rejects an edit from anyone but the owning candidate', async () => {
      const { processId } = await createOverallReview();
      const { cookie: otherCookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

      await server()
        .patch(`/processes/${processId}/overall-review`)
        .set('Cookie', otherCookie)
        .send({ ...overallReviewPayload, overallExperience: 1 })
        .expect(403);
    }, 20000);

    it('an edit resets status to pending and re-enqueues', async () => {
      const { cookie, processId, reviewId } = await createOverallReview();
      await approve(reviewId);

      const editRes = await server()
        .patch(`/processes/${processId}/overall-review`)
        .set('Cookie', cookie)
        .send({ ...overallReviewPayload, overallExperience: 1, wouldRecommend: false })
        .expect(200);
      expect(body<RatingBody>(editRes).status).toBe('pending');

      const entry = await findQueueEntryFor(reviewId);
      expect(entry.reviewedAt).toBeNull();
    }, 20000);

    it('deleting removes the review and its moderation_queue entry', async () => {
      const { cookie, processId, reviewId } = await createOverallReview();

      await server()
        .delete(`/processes/${processId}/overall-review`)
        .set('Cookie', cookie)
        .expect(204);

      const publicRes = await server().get(`/processes/${processId}/overall-review`).expect(200);
      expect(body<RatingBody>(publicRes).id).toBeUndefined();

      const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
      expect(body<QueueEntryBody[]>(queueRes).some((e) => e.entityId === reviewId)).toBe(false);
    }, 20000);
  });

  describe('edit throttle', () => {
    it('trips after repeated edits from the same candidate, across entity types', async () => {
      const { cookie, roundId, ratingId } = await createRoundRating();

      // 5 edits allowed per window (EditThrottleService) — the 6th, on any
      // guarded route for this candidate, must 429.
      for (let i = 0; i < 5; i++) {
        await server()
          .patch(`/rounds/${roundId}/ratings/${ratingId}`)
          .set('Cookie', cookie)
          .send({ ...roundRatingPayload, difficulty: (i % 5) + 1 })
          .expect(200);
      }

      await server()
        .patch(`/rounds/${roundId}/ratings/${ratingId}`)
        .set('Cookie', cookie)
        .send({ ...roundRatingPayload, difficulty: 3 })
        .expect(429);
    }, 30000);
  });
});
