import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';

interface CandidateBody {
  id: string;
}
interface CompanyBody {
  id: string;
}
interface ProcessBody {
  id: string;
}
interface ReviewBody {
  id: string;
  status: string;
  overallExperience: number;
  wouldRecommend: boolean;
}
interface QueueEntryBody {
  id: string;
  entityType: string;
  entityId: string;
  reviewedAt: string | null;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Proves the overall-review write path (Phase 14 issue #126) end to end —
// the last of the three rating/review entity types to get one. With this,
// ModerationService handles every ModerationEntityType and its
// NotImplementedException guard is gone entirely.
describe('Overall reviews (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

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
    adminCookie = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueSlug = () => `acme-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function createCandidateAndProcess(): Promise<{ candidateId: string; processId: string }> {
    const candidateRes = await server()
      .post('/candidates')
      .send({ email: uniqueEmail() })
      .expect(200);
    const candidateId = body<CandidateBody>(candidateRes).id;

    const companyRes = await server()
      .post('/companies')
      .send({ name: 'Acme Corp', slug: uniqueSlug(), sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .send({ candidateId, roleTitle: 'Senior Backend Engineer', outcome: 'offer' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    return { candidateId, processId };
  }

  async function submitReview(): Promise<{
    candidateId: string;
    processId: string;
    reviewId: string;
  }> {
    const { candidateId, processId } = await createCandidateAndProcess();

    const reviewRes = await server()
      .post(`/processes/${processId}/overall-review`)
      .send({
        candidateId,
        overallExperience: 4,
        wouldRecommend: true,
        reviewText: 'Structured, respectful, and quick to respond.',
      })
      .expect(201);
    const reviewId = body<ReviewBody>(reviewRes).id;

    return { candidateId, processId, reviewId };
  }

  async function findQueueEntryFor(reviewId: string): Promise<QueueEntryBody> {
    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = body<QueueEntryBody[]>(queueRes).find((e) => e.entityId === reviewId);
    if (!entry) throw new Error(`No moderation_queue entry found for review ${reviewId}`);
    return entry;
  }

  it('submitting a review starts pending and enqueues a matching moderation_queue entry', async () => {
    const { reviewId } = await submitReview();

    const entry = await findQueueEntryFor(reviewId);
    expect(entry.entityType).toBe('overall_review');
    expect(entry.reviewedAt).toBeNull();
  });

  it('the public read is empty while the review is still pending', async () => {
    const { processId } = await submitReview();

    const publicRes = await server().get(`/processes/${processId}/overall-review`).expect(200);
    expect(body<ReviewBody>(publicRes).id).toBeUndefined();
  });

  it('approving a pending review makes it publicly visible', async () => {
    const { processId, reviewId } = await submitReview();
    const entry = await findQueueEntryFor(reviewId);

    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({ reviewedBy: 'test-moderator' })
      .expect(201);

    const publicRes = await server().get(`/processes/${processId}/overall-review`).expect(200);
    const review = body<ReviewBody>(publicRes);
    expect(review.id).toBe(reviewId);
    expect(review.status).toBe('approved');
  });

  it('rejecting a pending review keeps the public read empty', async () => {
    const { processId, reviewId } = await submitReview();
    const entry = await findQueueEntryFor(reviewId);

    await server()
      .post(`/moderation/queue/${entry.id}/reject`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);

    const publicRes = await server().get(`/processes/${processId}/overall-review`).expect(200);
    expect(body<ReviewBody>(publicRes).id).toBeUndefined();
  });

  it('rejects a second overall review for the same process', async () => {
    const { candidateId, processId } = await submitReview();

    await server()
      .post(`/processes/${processId}/overall-review`)
      .send({ candidateId, overallExperience: 2, wouldRecommend: false })
      .expect(409);
  });

  it('rejects a review against a non-existent process', async () => {
    const { candidateId } = await createCandidateAndProcess();

    // FK violation -> 422 via PrismaExceptionFilter, same behavior as the
    // round-ratings write path for a non-existent parent.
    await server()
      .post('/processes/123e4567-e89b-12d3-a456-426614174000/overall-review')
      .send({ candidateId, overallExperience: 3, wouldRecommend: true })
      .expect(422);
  });

  it('rejects an invalid payload', async () => {
    const { processId } = await createCandidateAndProcess();

    await server()
      .post(`/processes/${processId}/overall-review`)
      .send({ overallExperience: 9 })
      .expect(400);
  });
});
