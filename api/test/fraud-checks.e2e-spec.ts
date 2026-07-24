import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';

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

  // A fresh app per test — see overall-reviews.e2e-spec.ts's comment for
  // why a shared beforeAll instance is fragile once several tests each
  // need their own candidate login (this file stays under the 5-per-
  // window threshold today, but a fresh instance per test removes the
  // risk of a future added test tipping it over).
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
  const uniqueSlug = () => `acme-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function loginNewCandidate(): Promise<string> {
    const { cookie } = await loginAsCandidate(app, uniqueEmail());
    return cookie;
  }

  async function createProcessWithRounds(candidateCookie: string, roundCount: number): Promise<string[]> {
    const companyRes = await server()
      .post('/companies')
      .set('Cookie', candidateCookie)
      .send({ name: 'Acme Corp', slug: uniqueSlug(), sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', candidateCookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
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
    candidateCookie: string,
    freeText?: string,
  ): Promise<{ ratingId: string; queueEntry: QueueEntryBody }> {
    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', candidateCookie)
      .send({
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
    const candidateCookie = await loginNewCandidate();
    // 4 rounds: 3 within the limit, the 4th should trip it (threshold is 3 —
    // see FraudChecksService.RATE_LIMIT_MAX_RATINGS).
    const [round1, round2, round3, round4] = await createProcessWithRounds(candidateCookie, 4);

    const first = await submitRating(round1, candidateCookie);
    const second = await submitRating(round2, candidateCookie);
    const third = await submitRating(round3, candidateCookie);
    const fourth = await submitRating(round4, candidateCookie);

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBeNull();
    expect(third.queueEntry.flagReason).toBeNull();
    expect(fourth.queueEntry.flagReason).toBe('rate_limit');
  }, 20000);

  it('flags a rating with duplicate when its free_text matches an existing one, but still creates it', async () => {
    const candidateCookieA = await loginNewCandidate();
    const candidateCookieB = await loginNewCandidate();
    const [roundA] = await createProcessWithRounds(candidateCookieA, 1);
    const [roundB] = await createProcessWithRounds(candidateCookieB, 1);

    // Unique per run — the dockerized dev Postgres persists data across
    // test runs (fraud-checks duplicate detection is a full-table scan by
    // design, see D13), so a fixed literal string here would collide with
    // leftover rows from a previous run instead of only this test's data.
    const reviewText = `Great interview, fair and well-structured questions. (${Date.now()}-${Math.floor(Math.random() * 1e6)})`;
    const first = await submitRating(roundA, candidateCookieA, reviewText);
    // Same text, different case/whitespace, different candidate/round.
    const second = await submitRating(roundB, candidateCookieB, `  ${reviewText.toUpperCase()}  `);

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBe('duplicate');
  }, 20000);

  it('does not flag distinct free_text submissions', async () => {
    const candidateCookie = await loginNewCandidate();
    const [roundId] = await createProcessWithRounds(candidateCookie, 1);

    const { queueEntry } = await submitRating(
      roundId,
      candidateCookie,
      `A genuinely unique review. (${Date.now()}-${Math.floor(Math.random() * 1e6)})`,
    );

    expect(queueEntry.flagReason).toBeNull();
  }, 15000);
});
