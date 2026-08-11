import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { ADMIN_TEST_USERNAME, loginAsAdmin, loginAsSecondModerator, loginAsStaff } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';
import { createApprovedCompany, createPendingCompany } from './support/companies';

// GitHub issue #383 / docs/DECISIONS.md D61 — a raw connection, bypassing
// the app's own Prisma service, to simulate exactly what a raw-SQL
// `DELETE FROM companies ...` (used repeatedly for manual live-verification
// test-data cleanup throughout this project) actually does: remove the
// entity row without ever touching its moderation_queue entry, since that
// polymorphic reference isn't a real FK (docs/DATA_MODEL.md).
const rawPrisma = new PrismaClient();

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
  claimedBy: { id: string; username: string } | null;
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

  afterAll(async () => {
    await rawPrisma.$disconnect();
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

  // GitHub issue #487 (Phase 36, D80) — manual claim/release, and the
  // "claimed by" badge GET /moderation/queue now carries via the joined
  // Moderator relation.
  describe('claim / release', () => {
    it('claiming an entry stamps claimedBy/claimedAt, visible on the next queue read', async () => {
      const { ratingId } = await submitRating();
      const entry = await findQueueEntryFor(ratingId);

      const claimRes = await server()
        .post(`/moderation/queue/${entry.id}/claim`)
        .set('Cookie', adminCookie)
        .expect(201);
      expect(body<{ claimedBy: { username: string } | null }>(claimRes).claimedBy).toMatchObject({
        username: ADMIN_TEST_USERNAME,
      });

      const requeried = await findQueueEntryFor(ratingId);
      expect(requeried.claimedBy).toMatchObject({ username: ADMIN_TEST_USERNAME });
    });

    it('rejects claiming an already-claimed entry', async () => {
      const { ratingId } = await submitRating();
      const entry = await findQueueEntryFor(ratingId);

      await server().post(`/moderation/queue/${entry.id}/claim`).set('Cookie', adminCookie).expect(201);
      await server().post(`/moderation/queue/${entry.id}/claim`).set('Cookie', adminCookie).expect(409);
    });

    it('releasing clears the claim, letting another moderator claim it', async () => {
      const { ratingId } = await submitRating();
      const entry = await findQueueEntryFor(ratingId);
      const second = await loginAsSecondModerator(app);

      await server().post(`/moderation/queue/${entry.id}/claim`).set('Cookie', adminCookie).expect(201);
      const releaseRes = await server()
        .post(`/moderation/queue/${entry.id}/release`)
        .set('Cookie', adminCookie)
        .expect(201);
      expect(body<{ claimedBy: unknown }>(releaseRes).claimedBy).toBeNull();

      await server().post(`/moderation/queue/${entry.id}/claim`).set('Cookie', second.cookie).expect(201);
    });

    it('forbids releasing a claim held by another moderator', async () => {
      const { ratingId } = await submitRating();
      const entry = await findQueueEntryFor(ratingId);
      const second = await loginAsSecondModerator(app);

      await server().post(`/moderation/queue/${entry.id}/claim`).set('Cookie', adminCookie).expect(201);
      await server().post(`/moderation/queue/${entry.id}/release`).set('Cookie', second.cookie).expect(403);
    });

    it('rejects releasing an unclaimed entry', async () => {
      const { ratingId } = await submitRating();
      const entry = await findQueueEntryFor(ratingId);

      await server().post(`/moderation/queue/${entry.id}/release`).set('Cookie', adminCookie).expect(409);
    });

    it('rejects unauthenticated claim/release requests with 401', async () => {
      await server().post('/moderation/queue/123e4567-e89b-12d3-a456-426614174000/claim').expect(401);
      await server().post('/moderation/queue/123e4567-e89b-12d3-a456-426614174000/release').expect(401);
    });
  });

  // GitHub issue #588 (Phase 42, D99) — a `staff` account gets the same
  // read access as `admin`/`moderator` (queue list + search) but no
  // moderation-action permission at all: every write route 403s.
  describe('permission boundaries (staff role)', () => {
    it('lets a staff account read the queue and search, but 403s every moderation action', async () => {
      const { ratingId } = await submitRating();
      const entry = await findQueueEntryFor(ratingId);
      const staffCookie = (await loginAsStaff(app)).cookie;

      await server().get('/moderation/queue').set('Cookie', staffCookie).expect(200);
      await server().get('/moderation/search').query({ q: 'test' }).set('Cookie', staffCookie).expect(200);

      await server()
        .post(`/moderation/queue/${entry.id}/approve`)
        .set('Cookie', staffCookie)
        .send({})
        .expect(403);
      await server()
        .post(`/moderation/queue/${entry.id}/reject`)
        .set('Cookie', staffCookie)
        .send({ reviewedBy: 'staff-account' })
        .expect(403);
      await server()
        .post(`/moderation/queue/${entry.id}/flag`)
        .set('Cookie', staffCookie)
        .send({ flagReason: 'manual_report' })
        .expect(403);
      await server().post(`/moderation/queue/${entry.id}/claim`).set('Cookie', staffCookie).expect(403);
      await server().post(`/moderation/queue/${entry.id}/release`).set('Cookie', staffCookie).expect(403);
    });
  });

  // GitHub issue #522 (Phase 41) — GET /moderation/queue's own server-side
  // filters, proven against a real Postgres rather than mocked Prisma
  // calls (unlike moderation.service.spec.ts's per-filter unit coverage).
  // Exercises entityType + claimState together, since claimState=mine
  // only makes sense scoped to entries the caller can actually tell apart.
  describe('GET /moderation/queue filters', () => {
    it('entityType + claimState narrow the queue to the matching type and the caller\'s own claim', async () => {
      const { ratingId: claimedRatingId } = await submitRating();
      const { ratingId: unclaimedRatingId } = await submitRating();

      const claimedEntry = await findQueueEntryFor(claimedRatingId);
      await server().post(`/moderation/queue/${claimedEntry.id}/claim`).set('Cookie', adminCookie).expect(201);

      const mineRes = await server()
        .get('/moderation/queue')
        .query({ entityType: 'round_rating', claimState: 'mine' })
        .set('Cookie', adminCookie)
        .expect(200);
      const mineEntityIds = body<QueueGroupBody[]>(mineRes)
        .flatMap((g) => g.entries)
        .map((e) => e.entityId);
      expect(mineEntityIds).toContain(claimedRatingId);
      expect(mineEntityIds).not.toContain(unclaimedRatingId);

      const unclaimedRes = await server()
        .get('/moderation/queue')
        .query({ entityType: 'round_rating', claimState: 'unclaimed' })
        .set('Cookie', adminCookie)
        .expect(200);
      const unclaimedEntityIds = body<QueueGroupBody[]>(unclaimedRes)
        .flatMap((g) => g.entries)
        .map((e) => e.entityId);
      expect(unclaimedEntityIds).toContain(unclaimedRatingId);
      expect(unclaimedEntityIds).not.toContain(claimedRatingId);
    });

    it('companyId narrows the queue to entries whose process belongs to that company', async () => {
      const { cookie: cookieA } = await loginAsCandidate(app, uniqueEmail());
      const companyA = await createApprovedCompany(app, cookieA, { name: 'Filter Co A', slug: uniqueSlug() });
      const processARes = await server()
        .post(`/companies/${companyA.id}/processes`)
        .set('Cookie', cookieA)
        .send({ roleTitle: 'Engineer A', outcome: 'in_progress' })
        .expect(201);
      const processAId = body<ProcessBody>(processARes).id;
      const { ratingId: ratingIdA } = await submitRatingUnderProcess(processAId);

      const { cookie: cookieB } = await loginAsCandidate(app, uniqueEmail());
      const companyB = await createApprovedCompany(app, cookieB, { name: 'Filter Co B', slug: uniqueSlug() });
      const processBRes = await server()
        .post(`/companies/${companyB.id}/processes`)
        .set('Cookie', cookieB)
        .send({ roleTitle: 'Engineer B', outcome: 'in_progress' })
        .expect(201);
      const processBId = body<ProcessBody>(processBRes).id;
      const { ratingId: ratingIdB } = await submitRatingUnderProcess(processBId);

      const filteredRes = await server()
        .get('/moderation/queue')
        .query({ companyId: companyA.id })
        .set('Cookie', adminCookie)
        .expect(200);
      const filteredEntityIds = body<QueueGroupBody[]>(filteredRes)
        .flatMap((g) => g.entries)
        .map((e) => e.entityId);
      expect(filteredEntityIds).toContain(ratingIdA);
      expect(filteredEntityIds).not.toContain(ratingIdB);
    });
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

  // GitHub issue #383 / docs/DECISIONS.md D61 — a real live bug: manual
  // live-verification test-data cleanup routinely uses a raw
  // `DELETE FROM companies ...` (see D44/D51), which never cleans up a
  // matching moderation_queue entry the way the app's own delete paths
  // (removeQueueEntries()) do. The orphaned entry then rendered as
  // "Unknown · Unknown" in the moderator UI and 404'd with a raw
  // "Record not found." if actioned. Both self-healing paths are proven
  // against a real Postgres here.
  describe('orphaned queue entries (entity deleted outside the app)', () => {
    it('listPending() removes an orphaned entry instead of surfacing it as Unknown · Unknown', async () => {
      const { cookie } = await loginAsCandidate(app, uniqueEmail());
      const company = await createPendingCompany(app, cookie, {
        name: 'Orphan Target Co',
        slug: uniqueSlug(),
      });
      const entryBefore = await findQueueEntryFor(company.id);

      // Simulate the raw-SQL cleanup gap directly — bypasses the app
      // entirely, exactly like a manual `DELETE FROM companies` would.
      await rawPrisma.company.delete({ where: { id: company.id } });

      const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
      const entries = body<QueueGroupBody[]>(queueRes).flatMap((g) => g.entries);
      expect(entries.find((e) => e.entityId === company.id)).toBeUndefined();

      const remaining = await rawPrisma.moderationQueueEntry.findUnique({ where: { id: entryBefore.id } });
      expect(remaining).toBeNull();
    });

    it('acting on an orphaned entry 404s with a clear message and cleans it up, rather than a raw Prisma error', async () => {
      const { cookie } = await loginAsCandidate(app, uniqueEmail());
      const company = await createPendingCompany(app, cookie, {
        name: 'Orphan Action Co',
        slug: uniqueSlug(),
      });
      const entry = await findQueueEntryFor(company.id);

      await rawPrisma.company.delete({ where: { id: company.id } });

      const res = await server()
        .post(`/moderation/queue/${entry.id}/approve`)
        .set('Cookie', adminCookie)
        .send({})
        .expect(404);
      expect((res.body as { message: string }).message).toContain('no longer exists');

      const remaining = await rawPrisma.moderationQueueEntry.findUnique({ where: { id: entry.id } });
      expect(remaining).toBeNull();
    });
  });
});
