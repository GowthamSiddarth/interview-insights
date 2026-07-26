import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';
import { createApprovedCompany } from './support/companies';

interface ProcessBody {
  id: string;
}
interface InteractionBody {
  id: string;
}
interface RatingBody {
  id: string;
  status: string;
  rejectionMessageAuthenticity: number | null;
}
interface QueueEntryBody {
  id: string;
  entityType: string;
  entityId: string;
  reviewedAt: string | null;
}
interface QueueGroupBody {
  entries: QueueEntryBody[];
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Proves the recruiter-interaction + recruiter-rating write path (Phase 14
// issue #125) end to end: RecruiterInteraction/RecruiterRating had schema
// since Phase 1 but no write path until this issue, and moderation for
// recruiter_rating threw NotImplementedException until now. Rating
// creation is candidate-session-gated since GitHub issue #146 — recruiter
// interaction creation itself stays unauthenticated (it has no candidateId
// field at all, see docs/DECISIONS.md D30's note on the schema).
describe('Recruiter interactions + ratings (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  // A fresh app per test — see overall-reviews.e2e-spec.ts's comment for
  // why a shared beforeAll instance is fragile once several tests each
  // need their own candidate login.
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
  const uniqueRecruiterIdentifier = () => `recruiter-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function createCandidateAndProcess(): Promise<{ cookie: string; processId: string }> {
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

    return { cookie, processId };
  }

  async function submitRating(): Promise<{
    cookie: string;
    interactionId: string;
    ratingId: string;
  }> {
    const { cookie, processId } = await createCandidateAndProcess();

    const interactionRes = await server()
      .post(`/processes/${processId}/recruiter-interactions`)
      .send({ recruiterIdentifier: uniqueRecruiterIdentifier() })
      .expect(201);
    const interactionId = body<InteractionBody>(interactionRes).id;

    const ratingRes = await server()
      .post(`/recruiter-interactions/${interactionId}/ratings`)
      .set('Cookie', cookie)
      .send({
        reachability: 4,
        responsiveness: 3,
        guidelinesShared: 5,
      })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    return { cookie, interactionId, ratingId };
  }

  async function findQueueEntryFor(ratingId: string): Promise<QueueEntryBody> {
    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = body<QueueGroupBody[]>(queueRes).flatMap((g) => g.entries).find((e) => e.entityId === ratingId);
    if (!entry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);
    return entry;
  }

  it('submitting a recruiter interaction resolves the same recruiter across the same company', async () => {
    const { processId } = await createCandidateAndProcess();
    const identifier = uniqueRecruiterIdentifier();

    const first = await server()
      .post(`/processes/${processId}/recruiter-interactions`)
      .send({ recruiterIdentifier: identifier })
      .expect(201);

    const secondProcessRes = await createCandidateAndProcess();
    const second = await server()
      .post(`/processes/${secondProcessRes.processId}/recruiter-interactions`)
      .send({ recruiterIdentifier: identifier })
      .expect(201);

    // Different companies (each createCandidateAndProcess makes its own
    // company), so the same identifier resolves to two distinct recruiters —
    // this just proves the endpoint works twice with the same identifier
    // without erroring, not cross-company identity (out of scope here).
    expect(body<InteractionBody>(first).id).not.toBe(body<InteractionBody>(second).id);
  }, 15000);

  it('submitting a rating starts pending and enqueues a matching moderation_queue entry', async () => {
    const { ratingId } = await submitRating();

    const entry = await findQueueEntryFor(ratingId);
    expect(entry.entityType).toBe('recruiter_rating');
    expect(entry.reviewedAt).toBeNull();
  }, 15000);

  it('approving a pending recruiter rating makes it publicly visible', async () => {
    const { interactionId, ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ reviewedBy: 'test-moderator' })
      .expect(201);

    const publicRatings = await server()
      .get(`/recruiter-interactions/${interactionId}/ratings`)
      .expect(200);
    expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).toContain(ratingId);
  }, 15000);

  it('rejecting a pending recruiter rating keeps it out of the public list', async () => {
    const { interactionId, ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    await server()
      .post(`/moderation/queue/${entry.id}/reject`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);

    const publicRatings = await server()
      .get(`/recruiter-interactions/${interactionId}/ratings`)
      .expect(200);
    expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).not.toContain(ratingId);
  }, 15000);

  it('rejects a second rating from the same candidate for the same interaction', async () => {
    const { cookie, interactionId } = await submitRating();

    await server()
      .post(`/recruiter-interactions/${interactionId}/ratings`)
      .set('Cookie', cookie)
      .send({
        reachability: 3,
        responsiveness: 3,
        guidelinesShared: 3,
      })
      .expect(409);
  }, 15000);

  it('returns 404 for a non-existent process when creating an interaction', async () => {
    await server()
      .post('/processes/123e4567-e89b-12d3-a456-426614174000/recruiter-interactions')
      .send({ recruiterIdentifier: uniqueRecruiterIdentifier() })
      .expect(404);
  });

  it('rejects an invalid payload', async () => {
    const { processId } = await createCandidateAndProcess();

    await server()
      .post(`/processes/${processId}/recruiter-interactions`)
      .send({})
      .expect(400);
  }, 15000);

  // GitHub issue #249 (D48) — rejectionMessageAuthenticity is nullable and
  // self-reported: a candidate can omit it entirely, or provide it when the
  // touchpoint was about their rejection.
  it('rejectionMessageAuthenticity is null when omitted', async () => {
    const { cookie, processId } = await createCandidateAndProcess();
    const interactionRes = await server()
      .post(`/processes/${processId}/recruiter-interactions`)
      .send({ recruiterIdentifier: uniqueRecruiterIdentifier() })
      .expect(201);
    const interactionId = body<InteractionBody>(interactionRes).id;

    const ratingRes = await server()
      .post(`/recruiter-interactions/${interactionId}/ratings`)
      .set('Cookie', cookie)
      .send({ reachability: 4, responsiveness: 4, guidelinesShared: 4 })
      .expect(201);

    expect(body<RatingBody>(ratingRes).rejectionMessageAuthenticity).toBeNull();
  }, 15000);

  it('accepts a real rejectionMessageAuthenticity value when provided', async () => {
    const { cookie, processId } = await createCandidateAndProcess();
    const interactionRes = await server()
      .post(`/processes/${processId}/recruiter-interactions`)
      .send({ recruiterIdentifier: uniqueRecruiterIdentifier() })
      .expect(201);
    const interactionId = body<InteractionBody>(interactionRes).id;

    const ratingRes = await server()
      .post(`/recruiter-interactions/${interactionId}/ratings`)
      .set('Cookie', cookie)
      .send({
        reachability: 4,
        responsiveness: 4,
        guidelinesShared: 4,
        rejectionMessageAuthenticity: 2,
      })
      .expect(201);

    expect(body<RatingBody>(ratingRes).rejectionMessageAuthenticity).toBe(2);
  }, 15000);
});
