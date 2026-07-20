import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';

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
    id: string;
    roundTitle: string;
    roundType: string;
    roleTitle: string;
    freeText: string | null;
  }>;
}
interface QueueEntryBody {
  id: string;
  entityId: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Proves the two Phase 15 issue #140 read paths against real Postgres:
// slug lookup, and the approved-only company reviews list (a
// source-of-truth read from Postgres, deliberately not OpenSearch —
// D16/D17).
describe('Company read paths: slug + reviews (e2e)', () => {
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
  const uniqueSlug = () => `profile-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function createCompanyWithRatings(counts: {
    approved: number;
    pending?: number;
  }): Promise<{ companyId: string; slug: string; approvedIds: string[] }> {
    const slug = uniqueSlug();
    const companyRes = await server()
      .post('/companies')
      .send({ name: 'Profile Co', slug, sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const approvedIds: string[] = [];
    const totalNeeded = counts.approved + (counts.pending ?? 0);
    for (let i = 0; i < totalNeeded; i++) {
      // One candidate per rating — sidesteps the one-rating-per-round
      // constraint and the fraud-check rate limit alike.
      const candidateRes = await server()
        .post('/candidates')
        .send({ email: uniqueEmail() })
        .expect(200);
      const candidateId = body<IdBody>(candidateRes).id;
      const processRes = await server()
        .post(`/companies/${companyId}/processes`)
        .send({ candidateId, roleTitle: 'Backend Engineer', outcome: 'offer' })
        .expect(201);
      const processId = body<IdBody>(processRes).id;
      const roundRes = await server()
        .post(`/processes/${processId}/rounds`)
        .send({ sequenceNumber: 1, title: 'Tech Screen', roundType: 'coding' })
        .expect(201);
      const roundId = body<IdBody>(roundRes).id;
      const ratingRes = await server()
        .post(`/rounds/${roundId}/ratings`)
        .send({
          candidateId,
          difficulty: 3,
          fairness: 4,
          communicationFluency: 4,
          attentiveness: 4,
          biasSignal: 5,
          freeText: `review number ${i} for ${slug}`,
        })
        .expect(201);
      const ratingId = body<IdBody>(ratingRes).id;

      if (i < counts.approved) {
        const queueRes = await server().get('/moderation/queue').expect(200);
        const entry = body<QueueEntryBody[]>(queueRes).find((e) => e.entityId === ratingId);
        if (!entry) throw new Error(`no queue entry for ${ratingId}`);
        await server().post(`/moderation/queue/${entry.id}/approve`).send({}).expect(201);
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
  });

  it('lists only approved reviews, shaped for display, without candidate identity', async () => {
    const { companyId, approvedIds } = await createCompanyWithRatings({
      approved: 1,
      pending: 1,
    });

    const res = await server().get(`/companies/${companyId}/reviews`).expect(200);
    const pageData = body<ReviewsPage>(res);

    expect(pageData.total).toBe(1);
    expect(pageData.items.map((i) => i.id)).toEqual(approvedIds);
    expect(pageData.items[0]).toMatchObject({
      roundTitle: 'Tech Screen',
      roundType: 'coding',
      roleTitle: 'Backend Engineer',
    });
    expect(JSON.stringify(pageData)).not.toContain('candidateId');
  });

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
    const allIds = [...page1.items, ...page2.items].map((i) => i.id);
    expect(new Set(allIds).size).toBe(3);
  });

  it('404s reviews for a company that does not exist', async () => {
    await server()
      .get('/companies/123e4567-e89b-12d3-a456-426614174000/reviews')
      .expect(404);
  });

  it('rejects invalid pagination params', async () => {
    const { companyId } = await createCompanyWithRatings({ approved: 0 });

    await server().get(`/companies/${companyId}/reviews?page=0`).expect(400);
    await server().get(`/companies/${companyId}/reviews?pageSize=51`).expect(400);
  });
});
