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
}
interface QueueEntryBody {
  id: string;
  entityId: string;
}
interface ReviewSearchResultBody {
  id: string;
  companyId: string;
  roleTitle: string;
  roundType: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Proves GitHub issue #22's acceptance criteria: an approved round rating
// becomes searchable/filterable; a pending/rejected/flagged one never
// appears; filtering by roleTitle/roundType/date range narrows results
// correctly, individually and combined.
describe('Review search (e2e)', () => {
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

  async function createRating(
    roleTitle: string,
    roundType: 'coding' | 'behavioral',
    freeText: string,
  ): Promise<{ companyId: string; ratingId: string }> {
    const candidateRes = await server()
      .post('/candidates')
      .send({ email: `candidate-${unique()}@example.com` })
      .expect(200);
    const candidateId = body<CandidateBody>(candidateRes).id;

    const companyRes = await server()
      .post('/companies')
      .send({ name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .send({ candidateId, roleTitle, outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Round 1', roundType })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .send({
        candidateId,
        difficulty: 3,
        fairness: 4,
        communicationFluency: 4,
        attentiveness: 4,
        biasSignal: 5,
        freeText,
      })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    return { companyId, ratingId };
  }

  async function findQueueEntryFor(ratingId: string): Promise<QueueEntryBody> {
    const queueRes = await server().get('/moderation/queue').expect(200);
    const entry = body<QueueEntryBody[]>(queueRes).find((e) => e.entityId === ratingId);
    if (!entry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);
    return entry;
  }

  async function approve(ratingId: string): Promise<void> {
    const entry = await findQueueEntryFor(ratingId);
    await server().post(`/moderation/queue/${entry.id}/approve`).send({}).expect(201);
  }

  async function reject(ratingId: string): Promise<void> {
    const entry = await findQueueEntryFor(ratingId);
    await server().post(`/moderation/queue/${entry.id}/reject`).send({}).expect(201);
  }

  it('makes an approved review searchable by companyId', async () => {
    const marker = unique();
    const { companyId, ratingId } = await createRating(
      'Senior Backend Engineer',
      'coding',
      `A genuinely unique review ${marker}`,
    );
    await approve(ratingId);

    const res = await server().get('/search/reviews').query({ companyId }).expect(200);
    const results = body<ReviewSearchResultBody[]>(res);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(ratingId);
  });

  it('never surfaces a rejected review', async () => {
    const marker = unique();
    const { companyId, ratingId } = await createRating(
      'Senior Backend Engineer',
      'coding',
      `A rejected review ${marker}`,
    );
    await reject(ratingId);

    const res = await server().get('/search/reviews').query({ companyId }).expect(200);
    expect(body<ReviewSearchResultBody[]>(res)).toEqual([]);
  });

  it('never surfaces a still-pending review', async () => {
    const marker = unique();
    const { companyId } = await createRating(
      'Senior Backend Engineer',
      'coding',
      `A pending review ${marker}`,
    );
    // Not approved or rejected — stays pending.

    const res = await server().get('/search/reviews').query({ companyId }).expect(200);
    expect(body<ReviewSearchResultBody[]>(res)).toEqual([]);
  });

  it('filters by roleTitle', async () => {
    const marker = unique();
    const matching = await createRating(`Staff Engineer ${marker}`, 'coding', 'text one');
    const nonMatching = await createRating(`Product Manager ${marker}`, 'coding', 'text two');
    await approve(matching.ratingId);
    await approve(nonMatching.ratingId);

    const res = await server()
      .get('/search/reviews')
      .query({ roleTitle: `Staff Engineer ${marker}` })
      .expect(200);
    const results = body<ReviewSearchResultBody[]>(res);

    expect(results.some((r) => r.id === matching.ratingId)).toBe(true);
    expect(results.some((r) => r.id === nonMatching.ratingId)).toBe(false);
  });

  it('filters by roundType', async () => {
    const marker = unique();
    const coding = await createRating(`Engineer ${marker}`, 'coding', `coding text ${marker}`);
    const behavioral = await createRating(
      `Engineer ${marker}`,
      'behavioral',
      `behavioral text ${marker}`,
    );
    await approve(coding.ratingId);
    await approve(behavioral.ratingId);

    const res = await server()
      .get('/search/reviews')
      .query({ companyId: coding.companyId, roundType: 'coding' })
      .expect(200);
    const results = body<ReviewSearchResultBody[]>(res);

    expect(results.some((r) => r.id === coding.ratingId)).toBe(true);
    expect(results.every((r) => r.roundType === 'coding')).toBe(true);
  });

  it('filters by date range', async () => {
    const marker = unique();
    const { companyId, ratingId } = await createRating(
      'Engineer',
      'coding',
      `date range text ${marker}`,
    );
    await approve(ratingId);

    const withinRange = await server()
      .get('/search/reviews')
      .query({ companyId, dateFrom: '2000-01-01', dateTo: '2100-01-01' })
      .expect(200);
    expect(body<ReviewSearchResultBody[]>(withinRange).some((r) => r.id === ratingId)).toBe(true);

    const outsideRange = await server()
      .get('/search/reviews')
      .query({ companyId, dateFrom: '2100-01-01' })
      .expect(200);
    expect(body<ReviewSearchResultBody[]>(outsideRange)).toEqual([]);
  });

  it('narrows results with combined filters', async () => {
    const marker = unique();
    const target = await createRating(`Staff Engineer ${marker}`, 'coding', `combo text ${marker}`);
    const wrongRoundType = await createRating(
      `Staff Engineer ${marker}`,
      'behavioral',
      `combo text ${marker}`,
    );
    await approve(target.ratingId);
    await approve(wrongRoundType.ratingId);

    const res = await server()
      .get('/search/reviews')
      .query({
        companyId: target.companyId,
        roleTitle: `Staff Engineer ${marker}`,
        roundType: 'coding',
      })
      .expect(200);
    const results = body<ReviewSearchResultBody[]>(res);

    expect(results.map((r) => r.id)).toEqual([target.ratingId]);
  });

  it('rejects an invalid roundType filter', async () => {
    await server().get('/search/reviews').query({ roundType: 'not-a-real-type' }).expect(400);
  });
});
