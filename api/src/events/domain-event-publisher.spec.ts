import { Test, TestingModule } from '@nestjs/testing';
import { DomainEventPublisher } from './domain-event-publisher';
import { EVENT_PRODUCER } from './redpanda-client.provider';
import {
  ROUND_RATING_CREATED_V1_TOPIC,
  RoundRatingCreatedEventV1,
} from './schemas/round-rating-created.event';

describe('DomainEventPublisher', () => {
  let service: DomainEventPublisher;
  let producer: {
    connect: jest.Mock;
    disconnect: jest.Mock;
    send: jest.Mock;
    on: jest.Mock;
    events: { CONNECT: string; DISCONNECT: string };
  };
  let disconnectListener: (() => void) | undefined;

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
    disconnectListener = undefined;
    producer = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue(undefined),
      events: { CONNECT: 'producer.connect', DISCONNECT: 'producer.disconnect' },
      on: jest.fn((eventName: string, listener: () => void) => {
        if (eventName === 'producer.disconnect') disconnectListener = listener;
      }),
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

  describe('reconnect-on-recovery (GitHub issue #459)', () => {
    it('retries a connect that never succeeded at boot, and resumes publishing once it does', async () => {
      producer.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      service = await buildService();
      await service.onModuleInit();

      await expect(
        service.publish(ROUND_RATING_CREATED_V1_TOPIC, event),
      ).resolves.toBeUndefined();
      expect(producer.send).not.toHaveBeenCalled();

      producer.connect.mockResolvedValueOnce(undefined);
      await service.retryConnectIfNeeded();

      await service.publish(ROUND_RATING_CREATED_V1_TOPIC, event, event.roundRatingId);
      expect(producer.send).toHaveBeenCalledWith({
        topic: ROUND_RATING_CREATED_V1_TOPIC,
        messages: [{ key: event.roundRatingId, value: JSON.stringify(event) }],
      });
    });

    it('does not attempt to reconnect while already connected', async () => {
      service = await buildService();
      await service.onModuleInit();
      producer.connect.mockClear();

      await service.retryConnectIfNeeded();

      expect(producer.connect).not.toHaveBeenCalled();
    });

    it('reconnects after a live disconnect surfaced via the DISCONNECT listener', async () => {
      service = await buildService();
      await service.onModuleInit();
      expect(disconnectListener).toBeDefined();

      disconnectListener?.();
      await expect(
        service.publish(ROUND_RATING_CREATED_V1_TOPIC, event),
      ).resolves.toBeUndefined();
      expect(producer.send).not.toHaveBeenCalled();

      await service.retryConnectIfNeeded();

      await service.publish(ROUND_RATING_CREATED_V1_TOPIC, event, event.roundRatingId);
      expect(producer.send).toHaveBeenCalledWith({
        topic: ROUND_RATING_CREATED_V1_TOPIC,
        messages: [{ key: event.roundRatingId, value: JSON.stringify(event) }],
      });
    });

    it('does not reconnect after module destroy', async () => {
      producer.connect.mockRejectedValue(new Error('ECONNREFUSED'));
      service = await buildService();
      await service.onModuleInit();
      await service.onModuleDestroy();
      producer.connect.mockClear();

      await service.retryConnectIfNeeded();

      expect(producer.connect).not.toHaveBeenCalled();
    });
  });
});
