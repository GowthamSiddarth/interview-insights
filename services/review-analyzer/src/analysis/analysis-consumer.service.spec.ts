import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisConsumerService } from './analysis-consumer.service';
import { EVENT_CONSUMER } from '../events/redpanda-client.provider';
import { ROUND_RATING_CREATED_V1_TOPIC } from '../events/schemas/round-rating-created.event';
import { RECRUITER_RATING_CREATED_V1_TOPIC } from '../events/schemas/recruiter-rating-created.event';
import { OVERALL_REVIEW_CREATED_V1_TOPIC } from '../events/schemas/overall-review-created.event';

// Plain mock-shaped type (jest.Mock properties, not the real Consumer
// class type) — matching this project's existing mocking convention
// (api/scripts/seed-demo-data-undo.spec.ts) and avoiding
// @typescript-eslint/unbound-method false positives that a cast to the
// real class type would trigger on every `expect(mock.method)` below.
interface MockConsumer {
  connect: jest.Mock;
  disconnect: jest.Mock;
  subscribe: jest.Mock;
  run: jest.Mock;
  on: jest.Mock;
  events: { DISCONNECT: string };
}

function fakeConsumer(): MockConsumer {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    events: { DISCONNECT: 'consumer.disconnect' },
  };
}

describe('AnalysisConsumerService', () => {
  let service: AnalysisConsumerService;
  let consumer: MockConsumer;

  beforeEach(async () => {
    consumer = fakeConsumer();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalysisConsumerService, { provide: EVENT_CONSUMER, useValue: consumer }],
    }).compile();

    service = module.get(AnalysisConsumerService);
  });

  it('subscribes to all three moderation.*.created.v1 topics on init, never status_changed', async () => {
    await service.onModuleInit();

    expect(consumer.connect).toHaveBeenCalled();
    expect(consumer.subscribe).toHaveBeenCalledWith({
      topics: [ROUND_RATING_CREATED_V1_TOPIC, RECRUITER_RATING_CREATED_V1_TOPIC, OVERALL_REVIEW_CREATED_V1_TOPIC],
      fromBeginning: false,
    });
  });

  it('logs receipt of a well-formed created event without throwing', async () => {
    await expect(
      service.processEvent({
        eventType: 'moderation.round_rating.created',
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        roundRatingId: 'rr-1',
        roundId: 'round-1',
        candidateId: 'candidate-1',
        companyId: 'company-1',
        status: 'pending',
      }),
    ).resolves.toBeUndefined();
  });

  it('retryConnectIfNeeded reconnects only when not already connected', async () => {
    await service.onModuleInit();
    consumer.connect.mockClear();

    await service.retryConnectIfNeeded();
    expect(consumer.connect).not.toHaveBeenCalled();
  });

  it('disconnects on module destroy once connected', async () => {
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(consumer.disconnect).toHaveBeenCalled();
  });
});
