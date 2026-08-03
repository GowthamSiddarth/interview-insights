import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Producer } from 'kafkajs';
import { EVENT_PRODUCER } from './redpanda-client.provider';

// Same interval class of value as AnalysisConsumerService's own
// RECONNECT_INTERVAL_MS.
const RECONNECT_INTERVAL_MS = 30_000;

// Own copy of api/src/events/domain-event-publisher.ts (GitHub issue #340) —
// this service's first producer, publishing moderation.<type>.
// verdict_computed.v1 back to api (docs/DECISIONS.md D81). Same best-effort,
// never-throw-back-to-caller shape: a Redpanda outage must never crash the
// analysis pipeline that's trying to publish a verdict it just computed.
@Injectable()
export class VerdictPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VerdictPublisher.name);
  private connected = false;
  private destroyed = false;

  constructor(@Inject(EVENT_PRODUCER) private readonly producer: Producer) {}

  async onModuleInit(): Promise<void> {
    this.producer.on(this.producer.events.DISCONNECT, () => {
      this.connected = false;
    });
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (!this.connected) return;
    await this.producer.disconnect().catch((err: unknown) => {
      this.logger.error('Failed to disconnect Redpanda producer', err instanceof Error ? err.stack : err);
    });
  }

  @Interval(RECONNECT_INTERVAL_MS)
  async retryConnectIfNeeded(): Promise<void> {
    if (this.connected || this.destroyed) return;
    await this.connect();
  }

  private async connect(): Promise<void> {
    try {
      const wasDisconnected = !this.connected;
      await this.producer.connect();
      this.connected = true;
      if (wasDisconnected) this.logger.log('Connected to Redpanda');
    } catch (err) {
      this.logger.error(
        'Failed to connect to Redpanda — verdict_computed events will be dropped until the broker recovers',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async publish<T>(topic: string, event: T, key?: string): Promise<void> {
    if (!this.connected) {
      this.logger.warn(`Dropping event for topic "${topic}" — producer not connected`);
      return;
    }

    try {
      await this.producer.send({
        topic,
        messages: [{ key, value: JSON.stringify(event) }],
      });
    } catch (err) {
      this.logger.error(`Failed to publish event to topic "${topic}"`, err instanceof Error ? err.stack : err);
    }
  }
}
