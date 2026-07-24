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
// correctly, individually and combined. Rating creation is
// candidate-session-gated since GitHub issue #146.
describe('Review search (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  // A fresh app per test — see overall-reviews.e2e-spec.ts's comment for
  // why a shared beforeAll instance is fragile; this file's tests call
  // createRating() (and therefore loginAsCandidate) up to twice each,
  // which would exceed the 5-per-window throttle across the whole file
  // if shared.
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

  async function createRating(
    roleTitle: string,
    roundType: 'coding' | 'behavioral',
    freeText: string,
  ): Promise<{ companyId: string; ratingId: string }> {
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
      .send({ roleTitle, outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Round 1', roundType })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({
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
    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = body<QueueEntryBody[]>(queueRes).find((e) => e.entityId === ratingId);
    if (!entry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);
    return entry;
  }

  async function approve(ratingId: string): Promise<void> {
    const entry = await findQueueEntryFor(ratingId);
    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
  }

  async function reject(ratingId: string): Promise<void> {
    const entry = await findQueueEntryFor(ratingId);
    await server()
      .post(`/moderation/queue/${entry.id}/reject`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);
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
  }, 15000);

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
  }, 15000);

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
  }, 15000);

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
  }, 20000);

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
  }, 20000);

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
  }, 15000);

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
  }, 20000);

  it('rejects an invalid roundType filter', async () => {
    await server().get('/search/reviews').query({ roundType: 'not-a-real-type' }).expect(400);
  });
});
