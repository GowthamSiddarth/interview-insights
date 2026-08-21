import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';
import { createApprovedCompany, createPendingCompany, findCompanyQueueEntryId } from './support/companies';
import { findQueueEntry, QueueGroupBody } from './support/moderation-queue';
import { waitForEvent } from './support/redpanda';
import { RoundRatingCreatedEventV1 } from '../src/events/schemas/round-rating-created.event';
import { RoundRatingStatusChangedEventV1 } from '../src/events/schemas/round-rating-status-changed.event';
import { RecruiterRatingCreatedEventV1 } from '../src/events/schemas/recruiter-rating-created.event';
import { OverallReviewCreatedEventV1 } from '../src/events/schemas/overall-review-created.event';
import { CompanyCreatedEventV1 } from '../src/events/schemas/company-created.event';
import { CompanyStatusChangedEventV1 } from '../src/events/schemas/company-status-changed.event';
import { StaffAccountCreatedEventV1 } from '../src/events/schemas/staff-account-created.event';

interface ProcessBody {
  id: string;
}
interface RoundBody {
  id: string;
}
interface RatingBody {
  id: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Proves GitHub issue #332's acceptance criteria against a real Redpanda
// broker (.github/workflows/ci.yml's `redpanda` service container; the
// local docker-compose `redpanda` service otherwise) — not a mock, same
// "needs a real instance" standing as mail.e2e-spec.ts (D29). Every
// assertion here consumes the actual topic ModerationService published
// to, proving the wiring end to end rather than just that
// DomainEventPublisher.publish() was called (already covered by unit
// tests in moderation.service.spec.ts).
describe('Domain events (e2e, against a real Redpanda broker)', () => {
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

  it('submitting a round rating publishes a moderation.round_rating.created.v1 event', async () => {
    const { cookie, candidateId } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const company = await createApprovedCompany(app, cookie, {
      name: 'Acme Corp',
      slug: `acme-${unique()}`,
    });

    const processRes = await server()
      .post(`/companies/${company.id}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .set('Cookie', cookie)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({ difficulty: 3, fluency: 5, clarity: 4, focus: 4 })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    const event = await waitForEvent<RoundRatingCreatedEventV1>(
      'moderation.round_rating.created.v1',
      (e) => e.roundRatingId === ratingId,
    );

    expect(event).toMatchObject({
      eventType: 'moderation.round_rating.created',
      eventVersion: 1,
      roundRatingId: ratingId,
      roundId,
      candidateId,
      companyId: company.id,
      status: 'pending',
    });
  }, 20000);

  // GitHub issue #692 (Phase 49, D104) — an edit that resubmits
  // rejected/flagged content publishes a second *.created event (never
  // did before this issue), distinguished from the original submission's
  // by isResubmission/moderationQueueEntryId.
  it('resubmitting a rejected round rating publishes a second created.v1 event marked isResubmission', async () => {
    const { cookie, candidateId } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const company = await createApprovedCompany(app, cookie, {
      name: 'Acme Corp',
      slug: `acme-${unique()}`,
    });

    const processRes = await server()
      .post(`/companies/${company.id}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .set('Cookie', cookie)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({ difficulty: 3, fluency: 5, clarity: 4, focus: 4 })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    // Consume (and discard) the original submission's created event first
    // so the wait below can't accidentally match it instead.
    await waitForEvent<RoundRatingCreatedEventV1>(
      'moderation.round_rating.created.v1',
      (e) => e.roundRatingId === ratingId,
    );

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = findQueueEntry(body<QueueGroupBody[]>(queueRes), ratingId);
    if (!entry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);
    await server().post(`/moderation/queue/${entry.id}/reject`).set('Cookie', adminCookie).send({ rejectionReasonCategory: 'other' }).expect(201);

    await server()
      .patch(`/rounds/${roundId}/ratings/${ratingId}`)
      .set('Cookie', cookie)
      .send({ difficulty: 3, fluency: 5, clarity: 4, focus: 4 })
      .expect(200);

    const resubmissionEvent = await waitForEvent<RoundRatingCreatedEventV1>(
      'moderation.round_rating.created.v1',
      (e) => e.roundRatingId === ratingId && e.isResubmission === true,
    );

    expect(resubmissionEvent).toMatchObject({
      eventType: 'moderation.round_rating.created',
      roundRatingId: ratingId,
      candidateId,
      companyId: company.id,
      status: 'pending',
      isResubmission: true,
    });
    expect(resubmissionEvent.moderationQueueEntryId).toBeTruthy();
    expect(resubmissionEvent.moderationQueueEntryId).not.toBe(entry.id);
  }, 20000);

  it('approving a round rating publishes a moderation.round_rating.status_changed.v1 event', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const company = await createApprovedCompany(app, cookie, {
      name: 'Acme Corp',
      slug: `acme-${unique()}`,
    });

    const processRes = await server()
      .post(`/companies/${company.id}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .set('Cookie', cookie)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({ difficulty: 3, fluency: 5, clarity: 4, focus: 4 })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = findQueueEntry(body<QueueGroupBody[]>(queueRes), ratingId);
    if (!entry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);

    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ reviewedBy: 'gowtham' })
      .expect(201);

    const event = await waitForEvent<RoundRatingStatusChangedEventV1>(
      'moderation.round_rating.status_changed.v1',
      (e) => e.roundRatingId === ratingId,
    );

    expect(event).toMatchObject({
      eventType: 'moderation.round_rating.status_changed',
      roundRatingId: ratingId,
      previousStatus: 'pending',
      newStatus: 'approved',
      reviewedBy: 'gowtham',
    });
  }, 20000);

  // GitHub issue #698 (Phase 50, D104) — 'company' publishes *.created/
  // *.status_changed too now, previously a permanent no-op.
  it('submitting a company request publishes a moderation.company.created.v1 event', async () => {
    const { cookie, candidateId } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

    const company = await createPendingCompany(app, cookie, {
      name: 'Acme Corp',
      slug: `acme-${unique()}`,
    });

    const event = await waitForEvent<CompanyCreatedEventV1>(
      'moderation.company.created.v1',
      (e) => e.companyId === company.id,
    );

    expect(event).toMatchObject({
      eventType: 'moderation.company.created',
      companyId: company.id,
      candidateId,
      status: 'pending',
    });
  }, 20000);

  it('approving a company request publishes a moderation.company.status_changed.v1 event', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const company = await createPendingCompany(app, cookie, {
      name: 'Acme Corp',
      slug: `acme-${unique()}`,
    });
    const entryId = await findCompanyQueueEntryId(app, adminCookie, company.id);

    await server()
      .post(`/moderation/queue/${entryId}/approve`)
      .set('Cookie', adminCookie)
      .send({ reviewedBy: 'gowtham' })
      .expect(201);

    const event = await waitForEvent<CompanyStatusChangedEventV1>(
      'moderation.company.status_changed.v1',
      (e) => e.companyId === company.id,
    );

    expect(event).toMatchObject({
      eventType: 'moderation.company.status_changed',
      companyId: company.id,
      previousStatus: 'pending',
      newStatus: 'approved',
      reviewedBy: 'gowtham',
      moderationQueueEntryId: entryId,
    });
  }, 20000);

  // GitHub issue #251 (Phase 25) — the bulk-submission path is a
  // different write path than the incremental endpoints above, and
  // publishes the same *.created events for everything it creates.
  it('a bulk submission publishes *.created events for every rated/reviewed entity it creates', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const company = await createApprovedCompany(app, cookie, {
      name: 'Acme Corp',
      slug: `acme-${unique()}`,
    });

    const res = await server()
      .post(`/companies/${company.id}/processes/bulk`)
      .set('Cookie', cookie)
      .send({
        roleTitle: 'Senior Backend Engineer',
        outcome: 'offer',
        rounds: [
          {
            sequenceNumber: 1,
            title: 'Technical Screen',
            roundType: 'coding',
            rating: { difficulty: 3, fluency: 4, clarity: 4, focus: 4 },
          },
        ],
        recruiterInteractions: [
          {
            recruiterIdentifier: `recruiter-${unique()}@example.com`,
            rating: { reachability: 4, responsiveness: 4, guidelinesShared: 4 },
          },
        ],
        overallReview: { overallExperience: 5, wouldRecommend: true },
      })
      .expect(201);
    const processId = body<ProcessBody>(res).id;

    const [roundRatingEvent, recruiterRatingEvent, overallReviewEvent] = await Promise.all([
      waitForEvent<RoundRatingCreatedEventV1>('moderation.round_rating.created.v1', () => true),
      waitForEvent<RecruiterRatingCreatedEventV1>(
        'moderation.recruiter_rating.created.v1',
        () => true,
      ),
      waitForEvent<OverallReviewCreatedEventV1>(
        'moderation.overall_review.created.v1',
        (e) => e.processId === processId,
      ),
    ]);

    expect(roundRatingEvent.status).toBe('pending');
    expect(recruiterRatingEvent.status).toBe('pending');
    expect(overallReviewEvent.processId).toBe(processId);
  }, 20000);

  // GitHub issue #702 (Phase 51, D104) — proves the real Redpanda wiring
  // for the new staff.account.* event family; the other four
  // (role_changed/deactivated/reactivated/password_reset) share the
  // exact same publish call shape and are covered by unit tests in
  // staff-accounts.service.spec.ts instead of five near-duplicate e2e
  // cases here.
  it('creating a staff account publishes a staff.account.created.v1 event carrying the one-time password', async () => {
    const meRes = await server().get('/auth/admin/me').set('Cookie', adminCookie).expect(200);
    const { id: actorId } = body<{ id: string }>(meRes);
    const username = `staff-${unique()}`;

    const createRes = await server()
      .post('/admin/staff')
      .set('Cookie', adminCookie)
      .send({ username, email: `${username}@example.com`, role: 'moderator' })
      .expect(201);
    const created = body<{ id: string; password: string }>(createRes);

    const event = await waitForEvent<StaffAccountCreatedEventV1>(
      'staff.account.created.v1',
      (e) => e.moderatorId === created.id,
    );

    expect(event).toMatchObject({
      eventType: 'staff.account.created',
      moderatorId: created.id,
      email: `${username}@example.com`,
      role: 'moderator',
      actorId,
      temporaryPassword: created.password,
    });
    expect(event.actionId).toBeTruthy();
  }, 20000);
});

// D16/D17-style adversarial proof, same as every other best-effort
// side-effect in this app: a broker that's completely unreachable must
// never affect the write path. A standalone top-level describe (rather
// than nested inside the suite above) so its own REDPANDA_BROKERS
// override never touches the other tests' shared `beforeEach` app, which
// needs a genuinely working broker.
describe('Domain events (e2e) — broker outage', () => {
  const originalBrokers = process.env.REDPANDA_BROKERS;

  afterEach(() => {
    if (originalBrokers === undefined) delete process.env.REDPANDA_BROKERS;
    else process.env.REDPANDA_BROKERS = originalBrokers;
  });

  it('a round rating submission still succeeds end to end when Redpanda is unreachable', async () => {
    process.env.REDPANDA_BROKERS = '127.0.0.1:1';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.use(cookieParser());
    await app.init();

    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
      const server = () => request(app.getHttpServer());
      const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
      const company = await createApprovedCompany(app, cookie, {
        name: 'Acme Corp',
        slug: `acme-${unique()}`,
      });

      const processRes = await server()
        .post(`/companies/${company.id}/processes`)
        .set('Cookie', cookie)
        .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
        .expect(201);
      const processId = body<ProcessBody>(processRes).id;

      const roundRes = await server()
        .post(`/processes/${processId}/rounds`)
        .set('Cookie', cookie)
        .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
        .expect(201);
      const roundId = body<RoundBody>(roundRes).id;

      await server()
        .post(`/rounds/${roundId}/ratings`)
        .set('Cookie', cookie)
        .send({ difficulty: 3, fluency: 5, clarity: 4, focus: 4 })
        .expect(201);
    } finally {
      await app.close();
    }
  }, 30000);
});
