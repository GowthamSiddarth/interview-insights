import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';
import { createApprovedCompany } from './support/companies';
import { findQueueEntry, QueueGroupBody } from './support/moderation-queue';
import { publishTestEvent } from './support/redpanda-producer';
import {
  ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC,
  RoundRatingVerdictComputedEventV1,
} from '../src/events/schemas/round-rating-verdict-computed.event';

interface ProcessBody {
  id: string;
}
interface RoundBody {
  id: string;
}
interface RatingBody {
  id: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function waitUntil(condition: () => Promise<boolean>, timeoutMs = 15000, intervalMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return condition();
}

// Proves GitHub issue #340's/D81's acceptance criteria end to end against a
// real Redpanda broker: api's first-ever event consumer applies a
// review-analyzer-published verdict_computed event, same "needs a real
// instance, not a mock" standing as domain-events.e2e-spec.ts (which proves
// the *.created publish side of this same pipeline). Stands in for
// "review-analyzer's real consumer just published this," without needing
// review-analyzer itself running as part of api's own CI job.
//
// Found in CI: this is the one e2e file that actually needs its Kafka
// message delivered within a bounded poll — every other one of api's ~26
// e2e spec files also boots the full AppModule (for plain HTTP testing,
// unrelated to Kafka), and jest runs spec files across parallel workers.
// All of them sharing the fixed 'api' consumer group caused constant
// rebalancing (a join/leave from any other file could steal this file's
// partition assignment mid-test), occasionally delaying delivery past the
// polling window below. `API_KAFKA_CONSUMER_GROUP_ID` (read lazily by
// redpanda-client.provider.ts) opts this file into its own private group,
// set once for the whole file so its 4 tests' own beforeEach/afterEach
// app cycles never contend with each other either.
const ORIGINAL_GROUP_ID_ENV = process.env.API_KAFKA_CONSUMER_GROUP_ID;

describe('VerdictConsumerService (e2e, against a real Redpanda broker)', () => {
  let app: INestApplication;
  let adminCookie: string;

  beforeAll(() => {
    process.env.API_KAFKA_CONSUMER_GROUP_ID = `api-verdict-consumer-e2e-${randomUUID()}`;
  });

  afterAll(() => {
    if (ORIGINAL_GROUP_ID_ENV === undefined) delete process.env.API_KAFKA_CONSUMER_GROUP_ID;
    else process.env.API_KAFKA_CONSUMER_GROUP_ID = ORIGINAL_GROUP_ID_ENV;
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
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

  async function submitRoundRating(): Promise<string> {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);
    const company = await createApprovedCompany(app, cookie, { name: 'Acme Corp', slug: `acme-${unique()}` });

    const processRes = await server()
      .post(`/companies/${company.id}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' })
      .expect(201);
    const roundId = body<RoundBody>(roundRes).id;

    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', cookie)
      .send({ difficulty: 3, fluency: 5, clarity: 4, focus: 4 })
      .expect(201);

    return body<RatingBody>(ratingRes).id;
  }

  it('stores a published verdict onto the moderation queue entry without approving it', async () => {
    const ratingId = await submitRoundRating();
    const event: RoundRatingVerdictComputedEventV1 = {
      eventType: 'moderation.round_rating.verdict_computed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      roundRatingId: ratingId,
      verdict: { concerning: false, reasons: [], summary: 'Looks fine.', confidence: 0.6 },
      autoApprovalEligible: false,
      confidence: 0.6,
      model: 'claude-haiku-4-5',
      promptContent: 'p',
      responseText: 'r',
    };

    await publishTestEvent(ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC, event, ratingId);

    await expect(
      waitUntil(async () => {
        const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
        const entry = findQueueEntry(body<QueueGroupBody[]>(queueRes), ratingId);
        return entry?.entity?.moderationVerdict !== undefined && entry?.entity?.moderationVerdict !== null;
      }),
    ).resolves.toBe(true);

    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = findQueueEntry(body<QueueGroupBody[]>(queueRes), ratingId);
    expect(entry?.reviewedAt).toBeNull();
    expect(entry?.entity?.moderationVerdict).toMatchObject({ concerning: false, summary: 'Looks fine.' });
  }, 20000);

  it('auto-approves via the existing approveWithAudit flow when the published verdict is eligible', async () => {
    const ratingId = await submitRoundRating();
    const event: RoundRatingVerdictComputedEventV1 = {
      eventType: 'moderation.round_rating.verdict_computed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      roundRatingId: ratingId,
      verdict: { concerning: false, reasons: [], summary: 'Looks fine.', confidence: 0.95, autoApprovalEligible: true },
      autoApprovalEligible: true,
      confidence: 0.95,
      model: 'claude-haiku-4-5',
      promptContent: 'p',
      responseText: 'r',
    };

    await publishTestEvent(ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC, event, ratingId);

    await expect(
      waitUntil(async () => {
        const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
        return findQueueEntry(body<QueueGroupBody[]>(queueRes), ratingId) === undefined;
      }),
    ).resolves.toBe(true);
  }, 20000);

  // GitHub issue #442 (Phase 39, D71), ported by #340 — the reconciliation
  // sweep now lives in review-analyzer and publishes this same event shape
  // with `stalled: true` when a retry still can't produce a verdict.
  it('flags a stalled escalation event to a human-visible flag reason', async () => {
    const ratingId = await submitRoundRating();
    const event: RoundRatingVerdictComputedEventV1 = {
      eventType: 'moderation.round_rating.verdict_computed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      roundRatingId: ratingId,
      verdict: null,
      autoApprovalEligible: false,
      confidence: null,
      model: null,
      promptContent: null,
      responseText: null,
      stalled: true,
    };

    await publishTestEvent(ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC, event, ratingId);

    await expect(
      waitUntil(async () => {
        const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
        const entry = findQueueEntry(body<QueueGroupBody[]>(queueRes), ratingId);
        return entry?.flagReason === 'ai_triage_stalled';
      }),
    ).resolves.toBe(true);
  }, 20000);

  it('ignores an event for an id it has never seen without crashing (malformed/unknown redelivery)', async () => {
    const event: RoundRatingVerdictComputedEventV1 = {
      eventType: 'moderation.round_rating.verdict_computed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      roundRatingId: randomUUID(),
      verdict: { concerning: false },
      autoApprovalEligible: false,
      confidence: 0.5,
      model: 'claude-haiku-4-5',
      promptContent: 'p',
      responseText: 'r',
    };

    await expect(
      publishTestEvent(ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC, event, event.roundRatingId),
    ).resolves.toBeUndefined();
  }, 20000);
});
