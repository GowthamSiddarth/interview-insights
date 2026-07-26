import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';

interface IdBody {
  id: string;
}
interface CompanyBody {
  id: string;
  slug: string;
  name: string;
}
interface ReviewsPage {
  total: number;
  page: number;
  pageSize: number;
  items: Array<{
    processId: string;
    roleTitle: string;
    entries: Array<{
      id: string;
      roundTitle: string;
      roundType: string;
      freeText: string | null;
    }>;
  }>;
}
interface QueueEntryBody {
  id: string;
  entityId: string;
}
interface QueueGroupBody {
  entries: QueueEntryBody[];
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Proves the two Phase 15 issue #140 read paths against real Postgres:
// slug lookup, and the approved-only company reviews list (a
// source-of-truth read from Postgres, deliberately not OpenSearch —
// D16/D17). Rating creation is candidate-session-gated since GitHub
// issue #146.
describe('Company read paths: slug + reviews (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  // A fresh app per test — see overall-reviews.e2e-spec.ts's comment for
  // why a shared beforeAll instance is fragile; createCompanyWithRatings()
  // logs in one fresh candidate per rating, and some tests here need
  // several ratings in one call.
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
  const uniqueSlug = () => `profile-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function createCompanyWithRatings(counts: {
    approved: number;
    pending?: number;
  }): Promise<{ companyId: string; slug: string; approvedIds: string[] }> {
    const slug = uniqueSlug();
    // POST /companies is session-gated now too — a throwaway login just
    // for this, separate from the per-rating candidates below.
    const { cookie: setupCookie } = await loginAsCandidate(app, uniqueEmail());
    const companyRes = await server()
      .post('/companies')
      .set('Cookie', setupCookie)
      .send({ name: 'Profile Co', slug, sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const approvedIds: string[] = [];
    const totalNeeded = counts.approved + (counts.pending ?? 0);
    for (let i = 0; i < totalNeeded; i++) {
      // One candidate per rating — sidesteps the one-rating-per-round
      // constraint and the fraud-check rate limit alike.
      const { cookie } = await loginAsCandidate(app, uniqueEmail());
      const processRes = await server()
        .post(`/companies/${companyId}/processes`)
        .set('Cookie', cookie)
        .send({ roleTitle: 'Backend Engineer', outcome: 'offer' })
        .expect(201);
      const processId = body<IdBody>(processRes).id;
      const roundRes = await server()
        .post(`/processes/${processId}/rounds`)
        .send({ sequenceNumber: 1, title: 'Tech Screen', roundType: 'coding' })
        .expect(201);
      const roundId = body<IdBody>(roundRes).id;
      const ratingRes = await server()
        .post(`/rounds/${roundId}/ratings`)
        .set('Cookie', cookie)
        .send({
          difficulty: 3,
          fluency: 4,
          clarity: 5,
          focus: 4,
          freeText: `review number ${i} for ${slug}`,
        })
        .expect(201);
      const ratingId = body<IdBody>(ratingRes).id;

      if (i < counts.approved) {
        const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
        const entry = body<QueueGroupBody[]>(queueRes).flatMap((g) => g.entries).find((e) => e.entityId === ratingId);
        if (!entry) throw new Error(`no queue entry for ${ratingId}`);
        await server()
          .post(`/moderation/queue/${entry.id}/approve`)
          .set('Cookie', adminCookie)
          .send({})
          .expect(201);
        approvedIds.push(ratingId);
      }
    }
    return { companyId, slug, approvedIds };
  }

  it('finds a company by slug, and 404s an unknown slug', async () => {
    const { companyId, slug } = await createCompanyWithRatings({ approved: 0 });

    const found = await server().get(`/companies/by-slug/${slug}`).expect(200);
    expect(body<CompanyBody>(found).id).toBe(companyId);

    await server().get('/companies/by-slug/does-not-exist-slug').expect(404);
  }, 15000);

  it('lists only approved reviews, shaped for display, without candidate identity', async () => {
    const { companyId, approvedIds } = await createCompanyWithRatings({
      approved: 1,
      pending: 1,
    });

    const res = await server().get(`/companies/${companyId}/reviews`).expect(200);
    const pageData = body<ReviewsPage>(res);

    expect(pageData.total).toBe(1);
    expect(pageData.items[0].entries.map((e) => e.id)).toEqual(approvedIds);
    expect(pageData.items[0]).toMatchObject({ roleTitle: 'Backend Engineer' });
    expect(pageData.items[0].entries[0]).toMatchObject({
      roundTitle: 'Tech Screen',
      roundType: 'coding',
    });
    expect(JSON.stringify(pageData)).not.toContain('candidateId');
  }, 20000);

  it('paginates', async () => {
    const { companyId } = await createCompanyWithRatings({ approved: 3 });

    const page1 = body<ReviewsPage>(
      await server().get(`/companies/${companyId}/reviews?page=1&pageSize=2`).expect(200),
    );
    const page2 = body<ReviewsPage>(
      await server().get(`/companies/${companyId}/reviews?page=2&pageSize=2`).expect(200),
    );

    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(1);
    const allProcessIds = [...page1.items, ...page2.items].map((i) => i.processId);
    expect(new Set(allProcessIds).size).toBe(3);
  }, 20000);

  // GitHub issue #347: a candidate's own multi-round submission must
  // appear as one grouped item, not one row per round — the exact
  // flat-list problem Phase 29 issue #315 already fixed for the
  // moderation queue.
  it('groups multiple approved round ratings from the same submission into one item', async () => {
    const slug = uniqueSlug();
    const { cookie: setupCookie } = await loginAsCandidate(app, uniqueEmail());
    const companyRes = await server()
      .post('/companies')
      .set('Cookie', setupCookie)
      .send({ name: 'Profile Co', slug, sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const { cookie } = await loginAsCandidate(app, uniqueEmail());
    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Staff Engineer', outcome: 'offer' })
      .expect(201);
    const processId = body<IdBody>(processRes).id;

    const ratingIds: string[] = [];
    for (const [seq, roundType] of [
      [1, 'coding'],
      [2, 'system_design'],
    ] as const) {
      const roundRes = await server()
        .post(`/processes/${processId}/rounds`)
        .send({ sequenceNumber: seq, title: `Round ${seq}`, roundType })
        .expect(201);
      const roundId = body<IdBody>(roundRes).id;
      const ratingRes = await server()
        .post(`/rounds/${roundId}/ratings`)
        .set('Cookie', cookie)
        .send({ difficulty: 3, fluency: 4, clarity: 4, focus: 4 })
        .expect(201);
      const ratingId = body<IdBody>(ratingRes).id;

      const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
      const entry = body<QueueGroupBody[]>(queueRes).flatMap((g) => g.entries).find((e) => e.entityId === ratingId);
      if (!entry) throw new Error(`no queue entry for ${ratingId}`);
      await server()
        .post(`/moderation/queue/${entry.id}/approve`)
        .set('Cookie', adminCookie)
        .send({})
        .expect(201);
      ratingIds.push(ratingId);
    }

    const res = await server().get(`/companies/${companyId}/reviews`).expect(200);
    const pageData = body<ReviewsPage>(res);

    expect(pageData.total).toBe(1);
    expect(pageData.items).toHaveLength(1);
    expect(pageData.items[0]).toMatchObject({ processId, roleTitle: 'Staff Engineer' });
    // Order isn't the point here (the service sorts entries createdAt-desc)
    // — grouping both ratings under one item is.
    expect(new Set(pageData.items[0].entries.map((e) => e.id))).toEqual(new Set(ratingIds));
  }, 20000);

  it('404s reviews for a company that does not exist', async () => {
    await server()
      .get('/companies/123e4567-e89b-12d3-a456-426614174000/reviews')
      .expect(404);
  });

  it('rejects invalid pagination params', async () => {
    const { companyId } = await createCompanyWithRatings({ approved: 0 });

    await server().get(`/companies/${companyId}/reviews?page=0`).expect(400);
    await server().get(`/companies/${companyId}/reviews?pageSize=51`).expect(400);
  }, 15000);
});
