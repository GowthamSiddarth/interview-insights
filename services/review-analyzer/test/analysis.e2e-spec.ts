import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AnalysisConsumerService } from '../src/analysis/analysis-consumer.service';
import { ROUND_RATING_CREATED_V1_TOPIC } from '../src/events/schemas/round-rating-created.event';
import { publishTestEvent } from './support/redpanda-producer';

// Proves GitHub issue #339's acceptance criteria end to end against a real
// broker (Redpanda) — same "needs a real instance, not a mock" standing as
// services/notification-service/test/notifications.e2e-spec.ts and
// api/test/domain-events.e2e-spec.ts. Stands in for "api's real write path
// just published this," without needing api itself running as part of
// this service's own CI job (see redpanda-producer.ts's own comment).
// Deliberately doesn't assert anything beyond "the event was received and
// dispatched" — GitHub issue #340 is where a real, assertable side effect
// (a stored verdict, a published verdict_computed event) shows up.
describe('AnalysisConsumerService (e2e, against a real Redpanda broker)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'a real moderation.round_rating.created.v1 event is received and dispatched to processEvent',
    async () => {
      const consumer = app.get(AnalysisConsumerService);
      const processed = jest.spyOn(consumer, 'processEvent');

      const roundRatingId = randomUUID();
      const event = {
        eventType: 'moderation.round_rating.created' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        roundRatingId,
        roundId: randomUUID(),
        candidateId: randomUUID(),
        companyId: randomUUID(),
        status: 'pending' as const,
      };

      await publishTestEvent(ROUND_RATING_CREATED_V1_TOPIC, event, roundRatingId);

      await expect(
        waitUntil(() => processed.mock.calls.some(([received]) => received.roundRatingId === roundRatingId)),
      ).resolves.toBe(true);
    },
    20_000,
  );
});

async function waitUntil(condition: () => boolean, timeoutMs = 15_000, intervalMs = 250): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return condition();
}
