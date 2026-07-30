import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Producer } from 'kafkajs';
import { EVENT_PRODUCER } from './redpanda-client.provider';

// Best-effort, after-commit event publishing — the same "never block or
// fail the write" shape as CompanySearchService/ReviewSearchService's
// OpenSearch indexing (docs/DECISIONS.md D16/D17), extended to a message
// broker by D53. A Redpanda outage, or the broker being entirely absent
// (e.g. CI, which doesn't run one), must never throw back to a caller —
// every failure path here is caught and logged, never rethrown.
@Injectable()
export class DomainEventPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventPublisher.name);
  private connected = false;

  constructor(@Inject(EVENT_PRODUCER) private readonly producer: Producer) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
      this.connected = true;
    } catch (err) {
      this.logger.error(
        'Failed to connect to Redpanda — domain events will be dropped until the app restarts',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.connected) return;
    await this.producer.disconnect().catch((err: unknown) => {
      this.logger.error(
        'Failed to disconnect Redpanda producer',
        err instanceof Error ? err.stack : err,
      );
    });
  }

  // `key` should be the aggregate id (e.g. the round rating id) so a
  // future partitioned topic keeps every event for the same entity in
  // order — a harmless no-op on today's single-partition topics.
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
      this.logger.error(
        `Failed to publish event to topic "${topic}"`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
