import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';

interface CandidateBody {
  id: string;
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
interface QueueEntryBody {
  id: string;
  entityType: string;
  entityId: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  flagReason: string | null;
  entity: Record<string, unknown> | null;
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

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new PrismaExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueSlug = () => `acme-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function submitRating(): Promise<{ candidateId: string; roundId: string; ratingId: string }> {
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
      .send({ candidateId, roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .send({
        candidateId,
        difficulty: 3,
        fairness: 4,
        communicationFluency: 5,
        attentiveness: 4,
        biasSignal: 5,
      })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    return { candidateId, roundId, ratingId };
  }

  async function findQueueEntryFor(ratingId: string): Promise<QueueEntryBody> {
    const queueRes = await server().get('/moderation/queue').expect(200);
    const entry = body<QueueEntryBody[]>(queueRes).find((e) => e.entityId === ratingId);
    if (!entry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);
    return entry;
  }

  it('submitting a rating enqueues a matching moderation_queue entry', async () => {
    const { ratingId } = await submitRating();

    const entry = await findQueueEntryFor(ratingId);
    expect(entry.entityType).toBe('round_rating');
    expect(entry.reviewedAt).toBeNull();
    // Enriched for the moderation UI (Phase 14 issue #128): the entity's
    // own fields plus display context, no second lookup needed.
    expect(entry.entity).toMatchObject({
      companyName: 'Acme Corp',
      roundTitle: 'Technical Screen',
      roundType: 'coding',
      difficulty: 3,
    });
  });

  it('approving a pending rating makes it publicly visible', async () => {
    const { roundId, ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .send({ reviewedBy: 'test-moderator' })
      .expect(201);

    const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
    expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).toContain(ratingId);
  });

  it('rejecting a pending rating keeps it out of the public list', async () => {
    const { roundId, ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    await server().post(`/moderation/queue/${entry.id}/reject`).send({}).expect(201);

    const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
    expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).not.toContain(ratingId);
  });

  it('flagging a pending rating records the reason and keeps it hidden', async () => {
    const { roundId, ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    const flagRes = await server()
      .post(`/moderation/queue/${entry.id}/flag`)
      .send({ flagReason: 'spam_pattern' })
      .expect(201);
    expect(body<QueueEntryBody>(flagRes).flagReason).toBe('spam_pattern');

    const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
    expect(body<RatingBody[]>(publicRatings).map((r) => r.id)).not.toContain(ratingId);
  });

  it('rejects reviewing the same entry twice', async () => {
    const { ratingId } = await submitRating();
    const entry = await findQueueEntryFor(ratingId);

    await server().post(`/moderation/queue/${entry.id}/approve`).send({}).expect(201);
    await server().post(`/moderation/queue/${entry.id}/approve`).send({}).expect(409);
  });

  it('returns 404 for a non-existent queue entry', async () => {
    await server()
      .post('/moderation/queue/123e4567-e89b-12d3-a456-426614174000/approve')
      .send({})
      .expect(404);
  });
});
