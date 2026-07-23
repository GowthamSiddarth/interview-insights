import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';

interface CandidateBody {
  id: string;
}
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
  entityId: string;
  flagReason: string | null;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Proves the two checks from docs/ROADMAP.md Phase 3 issue #2 actually flag
// suspicious writes — neither ever rejects the write outright (every rating
// still starts `pending`, CLAUDE.md hard constraint #2), they just attach a
// flagReason to the moderation_queue entry for a human reviewer.
describe('Fraud checks (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

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
    adminCookie = await loginAsAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueSlug = () => `acme-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function createCandidate(): Promise<string> {
    const res = await server().post('/candidates').send({ email: uniqueEmail() }).expect(200);
    return body<CandidateBody>(res).id;
  }

  async function createProcessWithRounds(candidateId: string, roundCount: number): Promise<string[]> {
    const companyRes = await server()
      .post('/companies')
      .send({ name: 'Acme Corp', slug: uniqueSlug(), sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .send({ candidateId, roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundIds: string[] = [];
    for (let i = 1; i <= roundCount; i++) {
      const roundRes = await server()
        .post(`/processes/${processId}/rounds`)
        .send({ sequenceNumber: i, title: `Round ${i}`, roundType: 'coding' })
        .expect(201);
      roundIds.push(body<RoundBody>(roundRes).id);
    }
    return roundIds;
  }

  async function submitRating(
    roundId: string,
    candidateId: string,
    freeText?: string,
  ): Promise<{ ratingId: string; queueEntry: QueueEntryBody }> {
    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .send({
        candidateId,
        difficulty: 3,
        fairness: 4,
        communicationFluency: 5,
        attentiveness: 4,
        biasSignal: 5,
        ...(freeText ? { freeText } : {}),
      })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const queueEntry = body<QueueEntryBody[]>(queueRes).find((e) => e.entityId === ratingId);
    if (!queueEntry) throw new Error(`No moderation_queue entry found for rating ${ratingId}`);

    return { ratingId, queueEntry };
  }

  it('flags a rating with rate_limit once a candidate exceeds the rolling window threshold, but still creates it', async () => {
    const candidateId = await createCandidate();
    // 4 rounds: 3 within the limit, the 4th should trip it (threshold is 3 —
    // see FraudChecksService.RATE_LIMIT_MAX_RATINGS).
    const [round1, round2, round3, round4] = await createProcessWithRounds(candidateId, 4);

    const first = await submitRating(round1, candidateId);
    const second = await submitRating(round2, candidateId);
    const third = await submitRating(round3, candidateId);
    const fourth = await submitRating(round4, candidateId);

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBeNull();
    expect(third.queueEntry.flagReason).toBeNull();
    expect(fourth.queueEntry.flagReason).toBe('rate_limit');
  });

  it('flags a rating with duplicate when its free_text matches an existing one, but still creates it', async () => {
    const candidateA = await createCandidate();
    const candidateB = await createCandidate();
    const [roundA] = await createProcessWithRounds(candidateA, 1);
    const [roundB] = await createProcessWithRounds(candidateB, 1);

    // Unique per run — the dockerized dev Postgres persists data across
    // test runs (fraud-checks duplicate detection is a full-table scan by
    // design, see D13), so a fixed literal string here would collide with
    // leftover rows from a previous run instead of only this test's data.
    const reviewText = `Great interview, fair and well-structured questions. (${Date.now()}-${Math.floor(Math.random() * 1e6)})`;
    const first = await submitRating(roundA, candidateA, reviewText);
    // Same text, different case/whitespace, different candidate/round.
    const second = await submitRating(roundB, candidateB, `  ${reviewText.toUpperCase()}  `);

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBe('duplicate');
  });

  it('does not flag distinct free_text submissions', async () => {
    const candidateId = await createCandidate();
    const [roundId] = await createProcessWithRounds(candidateId, 1);

    const { queueEntry } = await submitRating(
      roundId,
      candidateId,
      `A genuinely unique review. (${Date.now()}-${Math.floor(Math.random() * 1e6)})`,
    );

    expect(queueEntry.flagReason).toBeNull();
  });
});
