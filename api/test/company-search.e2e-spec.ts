import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsCandidate } from './support/candidate-session';
import { createApprovedCompany, createPendingCompany } from './support/companies';

interface SearchResultBody {
  id: string;
  name: string;
  slug: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Proves GitHub issue #21's acceptance criteria: an *approved* company is
// findable via search within the same request cycle — no indexing lag to
// account for (CompanySearchService.indexCompany uses refresh: true).
// Since GitHub issue #369 (Phase 35), indexing moves from creation time
// to approval time, so every test here approves the company first.
describe('Company search (e2e)', () => {
  let app: INestApplication;
  let candidateCookie: string;

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
    // One shared login for the whole file — POST /companies is
    // session-gated now, and every test here only needs *a* session, not
    // its own distinct candidate.
    candidateCookie = (await loginAsCandidate(app, `candidate-${unique()}@example.com`)).cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  it('makes a newly approved company searchable immediately', async () => {
    const uniqueName = `Zephyrion Analytics ${unique()}`;
    const company = await createApprovedCompany(app, candidateCookie, {
      name: uniqueName,
      slug: `zephyrion-${unique()}`,
    });

    const searchRes = await server()
      .get('/search/companies')
      .query({ q: uniqueName })
      .expect(200);
    const results = body<SearchResultBody[]>(searchRes);

    expect(results.some((r) => r.id === company.id)).toBe(true);
  });

  // GitHub issue #369 (Phase 35) — a pending company must never leak into
  // public search, since it hasn't been approved by a moderator yet.
  it('never surfaces a still-pending company', async () => {
    const uniqueName = `PendingCo ${unique()}`;
    await createPendingCompany(app, candidateCookie, {
      name: uniqueName,
      slug: `pending-${unique()}`,
    });

    const searchRes = await server()
      .get('/search/companies')
      .query({ q: uniqueName })
      .expect(200);
    const results = body<SearchResultBody[]>(searchRes);

    expect(results.some((r) => r.name === uniqueName)).toBe(false);
  });

  it('ranks a closer name match above a looser one', async () => {
    const marker = unique();
    const exactName = `Marker${marker} Corp`;
    const looseName = `Something Else Mentioning Marker${marker} In Passing`;

    const exact = await createApprovedCompany(app, candidateCookie, {
      name: exactName,
      slug: `exact-${marker}`,
    });
    const loose = await createApprovedCompany(app, candidateCookie, {
      name: looseName,
      slug: `loose-${marker}`,
    });

    const searchRes = await server()
      .get('/search/companies')
      .query({ q: exactName })
      .expect(200);
    const results = body<SearchResultBody[]>(searchRes);

    const exactIndex = results.findIndex((r) => r.id === exact.id);
    const looseIndex = results.findIndex((r) => r.id === loose.id);

    expect(exactIndex).toBeGreaterThanOrEqual(0);
    expect(looseIndex).toBeGreaterThanOrEqual(0);
    expect(exactIndex).toBeLessThan(looseIndex);
  });

  it('returns an empty array for a query that matches nothing', async () => {
    const res = await server()
      .get('/search/companies')
      .query({ q: `no-such-company-${unique()}` })
      .expect(200);

    expect(body<SearchResultBody[]>(res)).toEqual([]);
  });

  it('rejects a missing or empty query', async () => {
    await server().get('/search/companies').expect(400);
    await server().get('/search/companies').query({ q: '' }).expect(400);
  });
});
