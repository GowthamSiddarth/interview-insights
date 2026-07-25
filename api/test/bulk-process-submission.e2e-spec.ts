import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsCandidate } from './support/candidate-session';
import { loginAsAdmin } from './support/admin-session';

interface CompanyBody {
  id: string;
}
interface ProcessBody {
  id: string;
}
interface QueueEntryBody {
  id: string;
  entityType: string;
  entityId: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const rawPrisma = new PrismaClient();

// GitHub issue #251 (Phase 25) — a single transactional endpoint that
// accepts an entire interview-process tree in one payload. Existing
// per-entity endpoints (tested elsewhere) stay unchanged; this proves the
// bulk path specifically: full-tree creation, moderation-queue entries per
// rateable entity, atomic rollback on failure (no orphaned rows), and
// session gating.
describe('Bulk process submission (e2e)', () => {
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

  afterAll(async () => {
    await rawPrisma.$disconnect();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  async function createCompanyAndCandidate(): Promise<{ cookie: string; companyId: string }> {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const companyRes = await server()
      .post('/companies')
      .set('Cookie', cookie)
      .send({ name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid' })
      .expect(201);
    return { cookie, companyId: body<CompanyBody>(companyRes).id };
  }

  it('401s without a candidate session', async () => {
    const { companyId } = await createCompanyAndCandidate();

    await server()
      .post(`/companies/${companyId}/processes/bulk`)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(401);
  }, 15000);

  it('creates just the process when nothing else is submitted', async () => {
    const { cookie, companyId } = await createCompanyAndCandidate();

    const res = await server()
      .post(`/companies/${companyId}/processes/bulk`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(res).id;

    const rounds = await rawPrisma.round.findMany({ where: { processId } });
    expect(rounds).toHaveLength(0);
  }, 15000);

  it('creates a full tree (rounds+ratings, recruiter interaction+rating, overall review) with matching moderation_queue entries', async () => {
    const { cookie, companyId } = await createCompanyAndCandidate();

    const res = await server()
      .post(`/companies/${companyId}/processes/bulk`)
      .set('Cookie', cookie)
      .send({
        roleTitle: 'Senior Backend Engineer',
        outcome: 'offer',
        rounds: [
          {
            sequenceNumber: 1,
            title: 'Technical Screen',
            roundType: 'coding',
            typeMetadata: { problemAlgorithms: ['DFS'], problemDataStructures: ['Array'] },
            rating: { difficulty: 3, fluency: 4, clarity: 4, focus: 4 },
          },
          {
            sequenceNumber: 2,
            title: 'Onsite',
            roundType: 'system_design',
          },
        ],
        recruiterInteractions: [
          {
            recruiterIdentifier: `recruiter-${unique()}@example.com`,
            rating: { reachability: 4, responsiveness: 4, guidelinesShared: 4 },
          },
        ],
        overallReview: { overallExperience: 5, wouldRecommend: true },
      })
      .expect(201);
    const processId = body<ProcessBody>(res).id;

    const rounds = await rawPrisma.round.findMany({
      where: { processId },
      orderBy: { sequenceNumber: 'asc' },
    });
    expect(rounds).toHaveLength(2);

    const roundRatings = await rawPrisma.roundRating.findMany({
      where: { roundId: { in: rounds.map((r) => r.id) } },
    });
    expect(roundRatings).toHaveLength(1);

    const interactions = await rawPrisma.recruiterInteraction.findMany({ where: { processId } });
    expect(interactions).toHaveLength(1);

    const recruiterRatings = await rawPrisma.recruiterRating.findMany({
      where: { recruiterInteractionId: interactions[0].id },
    });
    expect(recruiterRatings).toHaveLength(1);

    const overallReview = await rawPrisma.overallReview.findFirst({ where: { processId } });
    expect(overallReview).not.toBeNull();

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entries = body<QueueEntryBody[]>(queueRes);
    const entityIds = new Set(entries.map((e) => e.entityId));
    expect(entityIds.has(roundRatings[0].id)).toBe(true);
    expect(entityIds.has(recruiterRatings[0].id)).toBe(true);
    expect(entityIds.has(overallReview!.id)).toBe(true);
  }, 20000);

  it('rolls back the entire submission when one nested entity fails validation — no orphaned rows', async () => {
    const { cookie, companyId } = await createCompanyAndCandidate();

    await server()
      .post(`/companies/${companyId}/processes/bulk`)
      .set('Cookie', cookie)
      .send({
        roleTitle: 'Senior Backend Engineer',
        outcome: 'in_progress',
        rounds: [
          { sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' },
          {
            sequenceNumber: 2,
            title: 'Bad Round',
            roundType: 'coding',
            typeMetadata: { problemAlgorithms: ['Not A Real Algorithm'] },
          },
        ],
      })
      .expect(400);

    const processes = await rawPrisma.interviewProcess.findMany({ where: { companyId } });
    expect(processes).toHaveLength(0);
  }, 15000);

  it('a client-supplied candidateId in the body is rejected outright by whitelist validation', async () => {
    const { cookie, companyId } = await createCompanyAndCandidate();

    await server()
      .post(`/companies/${companyId}/processes/bulk`)
      .set('Cookie', cookie)
      .send({
        roleTitle: 'Senior Backend Engineer',
        outcome: 'in_progress',
        candidateId: '00000000-0000-0000-0000-000000000000',
      })
      .expect(400);
  }, 15000);
});
