import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';
import { createApprovedCompany, createPendingCompany } from './support/companies';

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
interface QueueEntryBody {
  id: string;
  entityType: string;
  entityId: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  flagReason: string | null;
  entity: Record<string, unknown> | null;
}
interface QueueGroupBody {
  processId: string | null;
  companyName: string;
  roleTitle: string;
  entries: QueueEntryBody[];
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Proves the moderation loop actually closes end to end (docs/ROADMAP.md
// Phase 3 issue #1): a rating starts pending and invisible, a moderator
// action flips its status, and that's reflected in the existing public read
// endpoint built in Phase 2 — without this, that endpoint would stay empty
// forever.
describe('Moderation (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  // A fresh app (and therefore fresh admin-login and candidate
  // magic-link-request throttle state) per test — see
  // overall-reviews.e2e-spec.ts's comment for why a shared beforeAll
  // instance is fragile once several tests each need their own
  // candidate login.
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
  const uniqueSlug = () => `acme-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function submitRating(): Promise<{ processId: string; roundId: string; ratingId: string }> {
    const { cookie } = await loginAsCandidate(app, uniqueEmail());

    const { id: companyId } = await createApprovedCompany(app, cookie, {
      name: 'Acme Corp',
      slug: uniqueSlug(),
    });

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({
        sequenceNumber: 1,
        title: 'Technical Screen',
        roundType: 'coding',
        description: 'A live coding round over a shared editor',
        scheduledDurationMinutes: 45,
        typeMetadata: { problemAlgorithms: ['DFS'] },
      })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({
        difficulty: 3,
        fluency: 5,
        clarity: 4,
        focus: 4,
      })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    return { processId, roundId, ratingId };
  }

  async function submitRatingUnderProcess(processId: string): Promise<{ roundId: string; ratingId: string }> {
    const { cookie } = await loginAsCandidate(app, uniqueEmail());

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 2, title: 'Onsite', roundType: 'system_design' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({ difficulty: 4, fluency: 4, clarity: 4, focus: 4 })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    return { roundId, ratingId };
  }

  async function findQueueEntryFor(ratingId: string): Promise<QueueEntryBody> {
    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = body<QueueGroupBody[]>(queueRes).flatMap((g) => g.entries).find((e) => e.entityId === ratingId);
    if (!entry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);
    return entry;
  }

  it('submitting a rating enqueues a matching moderation_queue entry', async () => {
    const { ratingId } = await submitRating();

    const entry = await findQueueEntryFor(ratingId);
    expect(entry.entityType).toBe('round_rating');
    expect(entry.reviewedAt).toBeNull();
    // Enriched for the moderation UI (Phase 14 issue #128, extended by
    // #315 to surface the round's full submitted content — not just
    // highlights): the entity's own fields plus display context, no
    // second lookup needed.
    expect(entry.entity).toMatchObject({
      companyName: 'Acme Corp',
      roundTitle: 'Technical Screen',
      roundType: 'coding',
      roundDescription: 'A live coding round over a shared editor',
      roundTypeMetadata: { problemAlgorithms: ['DFS'] },
      roundScheduledDurationMinutes: 45,
      difficulty: 3,
    });
  });

  // GitHub issue #315: the queue groups every pending entity by its
  // InterviewProcess, so a moderator sees one collapsed row per
  // submission rather than one row per round/rating.
  it('groups multiple pending entities from the same process into one queue group', async () => {
    const { processId, ratingId: ratingId1 } = await submitRating();
    const { ratingId: ratingId2 } = await submitRatingUnderProcess(processId);

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const groups = body<QueueGroupBody[]>(queueRes);

    const group = groups.find((g) => g.processId === processId);
    if (!group) throw new Error(`No queue group found for process ${processId}`);
    expect(group.companyName).toBe('Acme Corp');
    expect(group.roleTitle).toBe('Senior Backend Engineer');

    const groupEntityIds = group.entries.map((e) => e.entityId);
    expect(groupEntityIds).toContain(ratingId1);
    expect(groupEntityIds).toContain(ratingId2);

    // A different process's own submission must never bleed into this group.
    const { processId: otherProcessId, ratingId: otherRatingId } = await submitRating();
    const queueResAfter = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const groupsAfter = body<QueueGroupBody[]>(queueResAfter);
    const otherGroup = groupsAfter.find((g) => g.processId === otherProcessId);
    if (!otherGroup) throw new Error(`No queue group found for process ${otherProcessId}`);
    expect(otherGroup.entries.map((e) => e.entityId)).toEqual([otherRatingId]);
    expect(otherGroup.entries.map((e) => e.entityId)).not.toContain(ratingId1);
    expect(otherGroup.entries.map((e) => e.entityId)).not.toContain(ratingId2);
  });

  it('approving a pending rating makes it publicly visible', async () => {
    const { roundId, ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ reviewedBy: 'test-moderator' })
      .expect(201);

    const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
    expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).toContain(ratingId);
  });

  it('rejecting a pending rating keeps it out of the public list', async () => {
    const { roundId, ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    await server()
      .post(`/moderation/queue/${entry.id}/reject`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);

    const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
    expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).not.toContain(ratingId);
  });

  it('flagging a pending rating records the reason and keeps it hidden', async () => {
    const { roundId, ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    const flagRes = await server()
      .post(`/moderation/queue/${entry.id}/flag`)
      .set('Cookie', adminCookie)
      .send({ flagReason: 'spam_pattern' })
      .expect(201);
    expect(body<QueueEntryBody>(flagRes).flagReason).toBe('spam_pattern');

    const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
    expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).not.toContain(ratingId);
  });

  it('rejects reviewing the same entry twice', async () => {
    const { ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(409);
  });

  it('returns 404 for a non-existent queue entry', async () => {
    await server()
      .post('/moderation/queue/123e4567-e89b-12d3-a456-426614174000/approve')
      .set('Cookie', adminCookie)
      .send({})
      .expect(404);
  });

  it('rejects an unauthenticated request with 401', async () => {
    await server().get('/moderation/queue').expect(401);
    await server().post('/moderation/queue/123e4567-e89b-12d3-a456-426614174000/approve').send({}).expect(401);
  });

  // GitHub issue #369 (Phase 35) — company creation now goes through the
  // same moderation loop as every other entity type, mirroring the
  // round_rating tests above.
  describe('company creation requests', () => {
    it('submitting a company creation request enqueues a matching moderation_queue entry', async () => {
      const { cookie } = await loginAsCandidate(app, uniqueEmail());
      const company = await createPendingCompany(app, cookie, {
        name: 'Pending Co',
        slug: uniqueSlug(),
      });

      const entry = await findQueueEntryFor(company.id);
      expect(entry.entityType).toBe('company');
      expect(entry.reviewedAt).toBeNull();
      expect(entry.entity).toMatchObject({
        companyName: 'Pending Co',
        requestedCompanySlug: company.slug,
        requestedCompanySizeBucket: 'mid',
      });
    });

    it('approving a pending company makes it publicly visible', async () => {
      const { cookie } = await loginAsCandidate(app, uniqueEmail());
      const company = await createPendingCompany(app, cookie, {
        name: 'Pending Co',
        slug: uniqueSlug(),
      });
      const entry = await findQueueEntryFor(company.id);

      await server()
        .post(`/moderation/queue/${entry.id}/approve`)
        .set('Cookie', adminCookie)
        .send({})
        .expect(201);

      const publicCompanies = await server().get('/companies').expect(200);
      expect(body<Array<{ id: string }>>(publicCompanies).map((c) => c.id)).toContain(company.id);
    });

    it('rejecting a pending company keeps it out of the public list', async () => {
      const { cookie } = await loginAsCandidate(app, uniqueEmail());
      const company = await createPendingCompany(app, cookie, {
        name: 'Pending Co',
        slug: uniqueSlug(),
      });
      const entry = await findQueueEntryFor(company.id);

      await server()
        .post(`/moderation/queue/${entry.id}/reject`)
        .set('Cookie', adminCookie)
        .send({})
        .expect(201);

      const publicCompanies = await server().get('/companies').expect(200);
      expect(body<Array<{ id: string }>>(publicCompanies).map((c) => c.id)).not.toContain(company.id);
    });
  });
});
