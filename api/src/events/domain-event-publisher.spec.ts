import { Test, TestingModule } from '@nestjs/testing';
import { DomainEventPublisher } from './domain-event-publisher';
import { EVENT_PRODUCER } from './redpanda-client.provider';
import {
  ROUND_RATING_CREATED_V1_TOPIC,
  RoundRatingCreatedEventV1,
} from './schemas/round-rating-created.event';

describe('DomainEventPublisher', () => {
  let service: DomainEventPublisher;
  let producer: { connect: jest.Mock; disconnect: jest.Mock; send: jest.Mock };

  const event: RoundRatingCreatedEventV1 = {
    eventType: 'moderation.round_rating.created',
    eventVersion: 1,
    occurredAt: '2026-07-30T00:00:00.000Z',
    roundRatingId: 'rr-1',
    roundId: 'round-1',
    candidateId: 'candidate-1',
    companyId: 'company-1',
    status: 'pending',
  };

  async function buildService(): Promise<DomainEventPublisher> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DomainEventPublisher, { provide: EVENT_PRODUCER, useValue: producer }],
    }).compile();

    return module.get(DomainEventPublisher);
  }

  beforeEach(() => {
    producer = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('publishes a JSON-serialized message to the given topic once connected', async () => {
    service = await buildService();
    await service.onModuleInit();

    await service.publish(ROUND_RATING_CREATED_V1_TOPIC, event, event.roundRatingId);

    expect(producer.send).toHaveBeenCalledWith({
      topic: ROUND_RATING_CREATED_V1_TOPIC,
      messages: [{ key: event.roundRatingId, value: JSON.stringify(event) }],
    });
  });

  it('never throws when producer.connect() fails, and drops publishes instead', async () => {
    producer.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    service = await buildService();

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    await expect(
      service.publish(ROUND_RATING_CREATED_V1_TOPIC, event),
    ).resolves.toBeUndefined();
    expect(producer.send).not.toHaveBeenCalled();
  });

  it('never throws when producer.send() fails after a successful connect', async () => {
    producer.send.mockRejectedValue(new Error('topic not found'));
    service = await buildService();
    await service.onModuleInit();

    await expect(
      service.publish(ROUND_RATING_CREATED_V1_TOPIC, event),
    ).resolves.toBeUndefined();
  });

  it('never throws when producer.disconnect() fails on module destroy', async () => {
    producer.disconnect.mockRejectedValue(new Error('ETIMEDOUT'));
    service = await buildService();
    await service.onModuleInit();

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('skips disconnect entirely if connect never succeeded', async () => {
    producer.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    service = await buildService();
    await service.onModuleInit();

    await service.onModuleDestroy();

    expect(producer.disconnect).not.toHaveBeenCalled();
  });
});
