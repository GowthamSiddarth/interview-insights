import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsCandidate } from './support/candidate-session';

interface CompanyBody {
  id: string;
  name: string;
}
interface SearchResultBody {
  id: string;
  name: string;
  slug: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Proves GitHub issue #21's acceptance criteria: creating a company makes
// it findable via search within the same request cycle — no indexing lag
// to account for (CompanySearchService.indexCompany uses refresh: true).
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

  it('makes a newly created company searchable immediately', async () => {
    const uniqueName = `Zephyrion Analytics ${unique()}`;
    const companyRes = await server()
      .post('/companies')
      .set('Cookie', candidateCookie)
      .send({ name: uniqueName, slug: `zephyrion-${unique()}`, sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const searchRes = await server()
      .get('/search/companies')
      .query({ q: uniqueName })
      .expect(200);
    const results = body<SearchResultBody[]>(searchRes);

    expect(results.some((r) => r.id === companyId)).toBe(true);
  });

  it('ranks a closer name match above a looser one', async () => {
    const marker = unique();
    const exactName = `Marker${marker} Corp`;
    const looseName = `Something Else Mentioning Marker${marker} In Passing`;

    const exactRes = await server()
      .post('/companies')
      .set('Cookie', candidateCookie)
      .send({ name: exactName, slug: `exact-${marker}`, sizeBucket: 'mid' })
      .expect(201);
    const looseRes = await server()
      .post('/companies')
      .set('Cookie', candidateCookie)
      .send({ name: looseName, slug: `loose-${marker}`, sizeBucket: 'mid' })
      .expect(201);

    const searchRes = await server()
      .get('/search/companies')
      .query({ q: exactName })
      .expect(200);
    const results = body<SearchResultBody[]>(searchRes);

    const exactId = body<CompanyBody>(exactRes).id;
    const looseId = body<CompanyBody>(looseRes).id;
    const exactIndex = results.findIndex((r) => r.id === exactId);
    const looseIndex = results.findIndex((r) => r.id === looseId);

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
