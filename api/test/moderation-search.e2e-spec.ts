import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';
import { createApprovedCompany, createPendingCompany } from './support/companies';
import { findQueueEntry, QueueGroupBody } from './support/moderation-queue';

interface ProcessBody {
  id: string;
}
interface RoundBody {
  id: string;
}
interface RatingBody {
  id: string;
}
interface SearchResultBody {
  id: string;
  entityType: string;
  entityId: string;
  entity: { companyName?: string } | null;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Proves GitHub issue #370's acceptance criteria against real Postgres +
// OpenSearch: a pending entity of any type becomes fuzzy-searchable within
// the same request cycle; a resolved one disappears; the category filter
// narrows correctly; and the endpoint 401s unauthenticated.
describe('Moderation search (e2e)', () => {
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

  async function searchFor(q?: string, category?: string) {
    const res = await server()
      .get('/moderation/search')
      .query({ ...(q ? { q } : {}), ...(category ? { category } : {}) })
      .set('Cookie', adminCookie)
      .expect(200);
    return body<SearchResultBody[]>(res);
  }

  async function submitRoundRating(companyName: string): Promise<{ ratingId: string }> {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const { id: companyId } = await createApprovedCompany(app, cookie, {
      name: companyName,
      slug: `search-verify-${unique()}`,
    });
    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;
    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;
    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({ difficulty: 3, fluency: 4, clarity: 5, focus: 4 })
      .expect(201);
    return { ratingId: body<RatingBody>(ratingRes).id };
  }

  it('401s an unauthenticated request', async () => {
    await server().get('/moderation/search').expect(401);
  });

  it('a newly submitted round rating becomes fuzzy-searchable within the same request cycle', async () => {
    const companyName = `Zephyrion Analytics ${unique()}`;
    const { ratingId } = await submitRoundRating(companyName);

    const results = await searchFor(companyName);

    expect(results.some((r) => r.entityId === ratingId)).toBe(true);
  }, 15000);

  it('a newly requested company becomes fuzzy-searchable within the same request cycle', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const companyName = `Marker Verify Co ${unique()}`;
    const company = await createPendingCompany(app, cookie, {
      name: companyName,
      slug: `search-verify-${unique()}`,
    });

    const results = await searchFor(companyName);

    expect(results.some((r) => r.entityId === company.id && r.entityType === 'company')).toBe(true);
  }, 15000);

  it('tolerates a typo (genuinely fuzzy, not just substring/partial matching)', async () => {
    const marker = unique();
    const companyName = `Fuzzytown${marker} Corp`;
    await submitRoundRating(companyName);

    // One transposed character — a real fuzzy-match case, not a partial
    // token match plain multi_match would already handle.
    const typoQuery = `Fuzzytwon${marker} Corp`;
    const results = await searchFor(typoQuery);

    expect(results.some((r) => r.entity?.companyName === companyName)).toBe(true);
  }, 15000);

  it('a resolved entity (approved) disappears from search results', async () => {
    const companyName = `Resolved Round Co ${unique()}`;
    const { ratingId } = await submitRoundRating(companyName);
    const before = await searchFor(companyName);
    expect(before.some((r) => r.entityId === ratingId)).toBe(true);

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = findQueueEntry(body<QueueGroupBody[]>(queueRes), ratingId);
    if (!entry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);
    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);

    const after = await searchFor(companyName);
    expect(after.some((r) => r.entityId === ratingId)).toBe(false);
  }, 15000);

  it('a resolved entity (rejected company) disappears from search results too', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const companyName = `Rejected Search Co ${unique()}`;
    const company = await createPendingCompany(app, cookie, {
      name: companyName,
      slug: `search-verify-${unique()}`,
    });
    const before = await searchFor(companyName);
    expect(before.some((r) => r.entityId === company.id)).toBe(true);

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = findQueueEntry(body<QueueGroupBody[]>(queueRes), company.id);
    if (!entry) throw new Error(`No moderation_queue entry found for company ${company.id}`);
    await server()
      .post(`/moderation/queue/${entry.id}/reject`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);

    const after = await searchFor(companyName);
    expect(after.some((r) => r.entityId === company.id)).toBe(false);
  }, 15000);

  it('the category filter narrows to just interview-review or just create-company entries', async () => {
    const marker = unique();
    const roundRatingName = `CategoryTest${marker} Round Co`;
    const { ratingId } = await submitRoundRating(roundRatingName);

    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const companyRequestName = `CategoryTest${marker} New Co`;
    const company = await createPendingCompany(app, cookie, {
      name: companyRequestName,
      slug: `search-verify-${unique()}`,
    });

    const interviewReviewResults = await searchFor(`CategoryTest${marker}`, 'interview-review');
    expect(interviewReviewResults.some((r) => r.entityId === ratingId)).toBe(true);
    expect(interviewReviewResults.some((r) => r.entityId === company.id)).toBe(false);

    const createCompanyResults = await searchFor(`CategoryTest${marker}`, 'create-company');
    expect(createCompanyResults.some((r) => r.entityId === company.id)).toBe(true);
    expect(createCompanyResults.some((r) => r.entityId === ratingId)).toBe(false);
  }, 15000);

  it('an edit brings a previously-resolved entity back into search', async () => {
    const companyName = `Reindex After Edit Co ${unique()}`;
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const { id: companyId } = await createApprovedCompany(app, cookie, {
      name: companyName,
      slug: `search-verify-${unique()}`,
    });
    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;
    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;
    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({ difficulty: 3, fluency: 4, clarity: 5, focus: 4 })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = findQueueEntry(body<QueueGroupBody[]>(queueRes), ratingId);
    if (!entry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);
    await server()
      .post(`/moderation/queue/${entry.id}/approve`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);

    const afterApprove = await searchFor(companyName);
    expect(afterApprove.some((r) => r.entityId === ratingId)).toBe(false);

    await server()
      .patch(`/rounds/${roundId}/ratings/${ratingId}`)
      .set('Cookie', cookie)
      .send({ difficulty: 5, fluency: 4, clarity: 5, focus: 4 })
      .expect(200);

    const afterEdit = await searchFor(companyName);
    expect(afterEdit.some((r) => r.entityId === ratingId)).toBe(true);
  }, 20000);
});
