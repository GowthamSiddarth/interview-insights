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
// bootstraps in main.ts, so global pipes/filters are exercised too.
describe('Vertical slice (e2e)', () => {
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

  it('creates a candidate idempotently by email', async () => {
    const email = uniqueEmail();

    const first = await server().post('/candidates').send({ email }).expect(200);
    const second = await server().post('/candidates').send({ email }).expect(200);

    expect(body<CandidateBody>(first).id).toBe(body<CandidateBody>(second).id);
    expect(first.body).not.toHaveProperty('emailHash');
    expect(first.body).not.toHaveProperty('email');
  });

  it('rejects a malformed email', async () => {
    await server().post('/candidates').send({ email: 'not-an-email' }).expect(400);
  });

  it('drives the full slice: company -> process -> round -> rating', async () => {
    const slug = uniqueSlug();

    const candidateRes = await server()
      .post('/candidates')
      .send({ email: uniqueEmail() })
      .expect(200);
    const candidateId = body<CandidateBody>(candidateRes).id;

    const companyRes = await server()
      .post('/companies')
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
      .send({ candidateId, roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
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
      .send({
        candidateId,
        difficulty: 3,
        fairness: 4,
        communicationFluency: 5,
        attentiveness: 4,
        biasSignal: 5,
      })
      .expect(201);
    // Every rating starts pending — CLAUDE.md hard constraint #2 / D3.
    expect(body<RatingBody>(ratingRes).status).toBe('pending');

    // One rating per candidate per round — D8.
    await server()
      .post(`/rounds/${roundId}/ratings`)
      .send({
        candidateId,
        difficulty: 1,
        fairness: 1,
        communicationFluency: 1,
        attentiveness: 1,
        biasSignal: 1,
      })
      .expect(409);

    // Public reads only ever surface moderation-approved ratings — with no
    // moderation worker yet (Phase 3), this is empty by design.
    const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
    expect(publicRatings.body).toEqual([]);
  });

  it('rejects an out-of-range rating', async () => {
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
      .send({
        candidateId,
        roleTitle: 'Senior Backend Engineer',
        outcome: 'in_progress',
      })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    await server()
      .post(`/rounds/${roundId}/ratings`)
      .send({
        candidateId,
        difficulty: 6,
        fairness: 4,
        communicationFluency: 5,
        attentiveness: 4,
        biasSignal: 5,
      })
      .expect(400);
  });

  it('returns 404 for a non-existent company and 400 for a malformed id', async () => {
    await server().get('/companies/123e4567-e89b-12d3-a456-426614174000').expect(404);
    await server().get('/companies/not-a-uuid').expect(400);
  });
});
