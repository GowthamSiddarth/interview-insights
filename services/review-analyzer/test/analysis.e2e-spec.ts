import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AnalysisConsumerService } from '../src/analysis/analysis-consumer.service';
import { VerdictPublisher } from '../src/events/verdict-publisher.service';
import { ROUND_RATING_CREATED_V1_TOPIC } from '../src/events/schemas/round-rating-created.event';
import { publishTestEvent } from './support/redpanda-producer';

// Proves GitHub issue #339's acceptance criteria end to end against a real
// broker (Redpanda) — same "needs a real instance, not a mock" standing as
// services/notification-service/test/notifications.e2e-spec.ts and
// api/test/domain-events.e2e-spec.ts. Stands in for "api's real write path
// just published this," without needing api itself running as part of
// this service's own CI job (see redpanda-producer.ts's own comment).
//
// GitHub issue #340 gave processEvent() its real body, but this CI
// environment has no real ANTHROPIC_API_KEY configured (D78 — never
// committed, real or placeholder) — the same "disabled by default"
// behavior production has whenever the key is unset. That means
// computeVerdict() always short-circuits to null here without ever
// touching Postgres, so the second test below asserts the one thing this
// environment can honestly prove: no verdict_computed event escapes when
// the feature is off. Actually exercising a real triage call (a real
// verdict published, or api's own consumer applying it) needs a real
// ANTHROPIC_API_KEY and is covered by the manual/live verification in
// docs/DECISIONS.md D81's own plan, not by CI.
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
      const publisher = app.get(VerdictPublisher);
      const publish = jest.spyOn(publisher, 'publish');

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
        waitUntil(() =>
          processed.mock.calls.some(
            ([received]) => received.eventType === 'moderation.round_rating.created' && received.roundRatingId === roundRatingId,
          ),
        ),
      ).resolves.toBe(true);

      // Disabled by default in this environment (no ANTHROPIC_API_KEY) —
      // computeVerdict() returns null before ever building content, so
      // nothing gets published for this event.
      expect(publish).not.toHaveBeenCalled();
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
