import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsCandidate } from './support/candidate-session';
import { createApprovedCompany } from './support/companies';

interface ProcessBody {
  id: string;
}
interface RoundBody {
  id: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const rawPrisma = new PrismaClient();

// GitHub issue #260 — a candidate can delete a process only when it has
// genuinely nothing in it (no rating/review in any status). Found live
// while verifying issue #247: abandoned mid-wizard processes (a round
// created, never rated) had no cleanup path at all on /me.
describe('Delete empty process (e2e)', () => {
  let app: INestApplication;

  // Fresh app per test — same reasoning as every other Phase 16+ e2e spec:
  // a shared instance's cumulative magic-link requests would trip the
  // throttle once several tests each need their own candidate.
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

  afterAll(async () => {
    await rawPrisma.$disconnect();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  async function createEmptyProcess(): Promise<{ cookie: string; processId: string }> {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

    const { id: companyId } = await createApprovedCompany(app, cookie, {
      name: 'Acme Corp',
      slug: `acme-${unique()}`,
    });

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    return { cookie, processId };
  }

  it('401s without a candidate session', async () => {
    const { processId } = await createEmptyProcess();
    await server().delete(`/processes/${processId}`).expect(401);
  });

  it('404s for a process that does not exist', async () => {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    await server()
      .delete('/processes/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie)
      .expect(404);
  });

  it('403s an attempt to delete another candidate\'s process', async () => {
    const { processId } = await createEmptyProcess();
    const { cookie: otherCookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

    await server().delete(`/processes/${processId}`).set('Cookie', otherCookie).expect(403);
  });

  it('deletes a genuinely empty process, its round, and cascades cleanly', async () => {
    const { cookie, processId } = await createEmptyProcess();

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .set('Cookie', cookie)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    await server().delete(`/processes/${processId}`).set('Cookie', cookie).expect(204);

    expect(await rawPrisma.interviewProcess.findUnique({ where: { id: processId } })).toBeNull();
    expect(await rawPrisma.round.findUnique({ where: { id: roundId } })).toBeNull();
  });

  it('409s a process with a pending (unmoderated) round rating', async () => {
    const { cookie, processId } = await createEmptyProcess();
    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .set('Cookie', cookie)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({ difficulty: 3, fluency: 4, clarity: 5, focus: 4 })
      .expect(201);

    await server().delete(`/processes/${processId}`).set('Cookie', cookie).expect(409);

    expect(await rawPrisma.interviewProcess.findUnique({ where: { id: processId } })).not.toBeNull();
  });

  it('409s a process with an overall review', async () => {
    const { cookie, processId } = await createEmptyProcess();

    await server()
      .post(`/processes/${processId}/overall-review`)
      .set('Cookie', cookie)
      .send({ overallExperience: 4, wouldRecommend: true })
      .expect(201);

    await server().delete(`/processes/${processId}`).set('Cookie', cookie).expect(409);
  });
});
