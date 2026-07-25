import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsCandidate } from './support/candidate-session';

interface CompanyBody {
  id: string;
  slug: string;
}
interface ProcessBody {
  id: string;
  rounds?: unknown[];
}
interface RoundBody {
  id: string;
}
interface RatingBody {
  status: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Drives the full Company -> InterviewProcess -> Round -> RoundRating slice
// against a real Postgres (docs/ROADMAP.md Phase 2), the same way the API
// bootstraps in main.ts, so global pipes/filters are exercised too. Every
// write in this slice (process, rating) is candidate-session-gated since
// GitHub issue #146 — candidate creation itself now only happens via the
// magic-link auth flow (issue #145), not a standalone POST /candidates.
describe('Vertical slice (e2e)', () => {
  let app: INestApplication;

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
  });

  afterEach(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueSlug = () => `acme-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  it('drives the full slice: company -> process -> round -> rating', async () => {
    const slug = uniqueSlug();
    const { cookie } = await loginAsCandidate(app, uniqueEmail());

    const companyRes = await server()
      .post('/companies')
      .set('Cookie', cookie)
      .send({ name: 'Acme Corp', slug, sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;
    expect(body<CompanyBody>(companyRes).slug).toBe(slug);

    await server()
      .get('/companies')
      .expect(200)
      .expect((res: request.Response) => {
        expect(body<CompanyBody[]>(res).some((c) => c.id === companyId)).toBe(true);
      });

    await server().get(`/companies/${companyId}`).expect(200).expect(companyRes.body as object);

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    await server()
      .get(`/companies/${companyId}/processes`)
      .expect(200)
      .expect((res: request.Response) => {
        expect(body<ProcessBody[]>(res).some((p) => p.id === processId)).toBe(true);
      });

    const processDetail = await server().get(`/processes/${processId}`).expect(200);
    expect(body<ProcessBody>(processDetail).rounds).toEqual([]);

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    await server()
      .get(`/processes/${processId}/rounds`)
      .expect(200)
      .expect((res: request.Response) => {
        expect(body<RoundBody[]>(res).map((r) => r.id)).toEqual([roundId]);
      });

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({
        difficulty: 3,
        fluency: 5,
        clarity: 5,
        focus: 4,
      })
      .expect(201);
    // Every rating starts pending — CLAUDE.md hard constraint #2 / D3.
    expect(body<RatingBody>(ratingRes).status).toBe('pending');

    // One rating per candidate per round — D8.
    await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({
        difficulty: 1,
        fluency: 1,
        clarity: 1,
        focus: 1,
      })
      .expect(409);

    // Public reads only ever surface moderation-approved ratings — this one
    // is still pending, so it stays hidden. See moderation.e2e-spec.ts for
    // the full pending -> approved -> publicly visible flow.
    const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
    expect(publicRatings.body).toEqual([]);
  }, 15000);

  it('rejects unauthenticated process/rating submissions', async () => {
    // Company creation itself needs a session too (a separate lockdown,
    // unrelated to what this test is about) — only the process-creation
    // call below is the actual unauthenticated case under test.
    const { cookie } = await loginAsCandidate(app, uniqueEmail());
    const companyRes = await server()
      .post('/companies')
      .set('Cookie', cookie)
      .send({ name: 'Acme Corp', slug: uniqueSlug(), sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    await server()
      .post(`/companies/${companyId}/processes`)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(401);
  });

  it('rejects an out-of-range rating', async () => {
    const { cookie } = await loginAsCandidate(app, uniqueEmail());

    const companyRes = await server()
      .post('/companies')
      .set('Cookie', cookie)
      .send({ name: 'Acme Corp', slug: uniqueSlug(), sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({
        difficulty: 6,
        fluency: 5,
        clarity: 5,
        focus: 4,
      })
      .expect(400);
  }, 15000);

  it('returns 404 for a non-existent company and 400 for a malformed id', async () => {
    await server().get('/companies/123e4567-e89b-12d3-a456-426614174000').expect(404);
    await server().get('/companies/not-a-uuid').expect(400);
  });
});
