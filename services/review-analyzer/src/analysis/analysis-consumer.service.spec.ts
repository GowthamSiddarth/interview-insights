import { Test, TestingModule } from '@nestjs/testing';
import { AnalysisConsumerService } from './analysis-consumer.service';
import { AnalysisService } from './analysis.service';
import { VerdictPublisher } from '../events/verdict-publisher.service';
import { EVENT_CONSUMER } from '../events/redpanda-client.provider';
import { ROUND_RATING_CREATED_V1_TOPIC } from '../events/schemas/round-rating-created.event';
import { RECRUITER_RATING_CREATED_V1_TOPIC } from '../events/schemas/recruiter-rating-created.event';
import { OVERALL_REVIEW_CREATED_V1_TOPIC } from '../events/schemas/overall-review-created.event';
import { ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC } from '../events/schemas/round-rating-verdict-computed.event';

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
  let analysisService: { computeVerdict: jest.Mock };
  let verdictPublisher: { publish: jest.Mock };

  beforeEach(async () => {
    consumer = fakeConsumer();
    analysisService = { computeVerdict: jest.fn().mockResolvedValue(null) };
    verdictPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisConsumerService,
        { provide: EVENT_CONSUMER, useValue: consumer },
        { provide: AnalysisService, useValue: analysisService },
        { provide: VerdictPublisher, useValue: verdictPublisher },
      ],
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

  const roundRatingCreatedEvent = {
    eventType: 'moderation.round_rating.created' as const,
    eventVersion: 1 as const,
    occurredAt: new Date().toISOString(),
    roundRatingId: 'rr-1',
    roundId: 'round-1',
    candidateId: 'candidate-1',
    companyId: 'company-1',
    status: 'pending' as const,
  };

  it('publishes nothing when computeVerdict returns null (disabled, gone entity, or failed call)', async () => {
    analysisService.computeVerdict.mockResolvedValue(null);

    await expect(service.processEvent(roundRatingCreatedEvent)).resolves.toBeUndefined();

    expect(analysisService.computeVerdict).toHaveBeenCalledWith('round_rating', 'rr-1');
    expect(verdictPublisher.publish).not.toHaveBeenCalled();
  });

  it('publishes a verdict_computed event when computeVerdict returns a result', async () => {
    analysisService.computeVerdict.mockResolvedValue({
      verdict: { concerning: false, autoApprovalEligible: true },
      promptContent: 'p',
      responseText: 'r',
      confidence: 0.9,
      model: 'claude-haiku-4-5',
    });

    await service.processEvent(roundRatingCreatedEvent);

    expect(verdictPublisher.publish).toHaveBeenCalledWith(
      ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC,
      expect.objectContaining({
        eventType: 'moderation.round_rating.verdict_computed',
        roundRatingId: 'rr-1',
        autoApprovalEligible: true,
        confidence: 0.9,
        model: 'claude-haiku-4-5',
      }) as unknown,
      'rr-1',
    );
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
