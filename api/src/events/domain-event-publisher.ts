import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Producer } from 'kafkajs';
import { EVENT_PRODUCER } from './redpanda-client.provider';

// Same interval class of value as review-analyzer's own AnalysisConsumerService/
// VerdictPublisher reconnect loops — long enough to never hammer a broker
// that's actually down, short enough that recovery is noticed promptly
// once it's back.
const RECONNECT_INTERVAL_MS = 30_000;

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
  private destroyed = false;

  constructor(@Inject(EVENT_PRODUCER) private readonly producer: Producer) {}

  async onModuleInit(): Promise<void> {
    // kafkajs emits this whenever the broker connection drops, independent
    // of any producer.connect()/send() call in flight — the only reliable
    // signal that a previously-healthy connection needs retryConnectIfNeeded()
    // to pick it back up.
    this.producer.on(this.producer.events.DISCONNECT, () => {
      this.connected = false;
    });
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (!this.connected) return;
    await this.producer.disconnect().catch((err: unknown) => {
      this.logger.error(
        'Failed to disconnect Redpanda producer',
        err instanceof Error ? err.stack : err,
      );
    });
  }

  // GitHub issue #459: a connection lost (or never established) at boot
  // used to never retry, silently dropping events until the app restarted
  // even after the broker recovered. This runs continuously — a no-op
  // once connected — rather than only scheduling a retry after a failed
  // attempt, so it self-heals whether the initial connect() never
  // succeeded or the DISCONNECT listener above dropped `connected` back
  // to false later.
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
        'Failed to connect to Redpanda — domain events will be dropped until the broker recovers',
        err instanceof Error ? err.stack : err,
      );
    }
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
