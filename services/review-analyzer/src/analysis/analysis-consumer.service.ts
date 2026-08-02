import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { EVENT_CONSUMER } from '../events/redpanda-client.provider';
import {
  ROUND_RATING_CREATED_V1_TOPIC,
  RoundRatingCreatedEventV1,
} from '../events/schemas/round-rating-created.event';
import {
  RECRUITER_RATING_CREATED_V1_TOPIC,
  RecruiterRatingCreatedEventV1,
} from '../events/schemas/recruiter-rating-created.event';
import {
  OVERALL_REVIEW_CREATED_V1_TOPIC,
  OverallReviewCreatedEventV1,
} from '../events/schemas/overall-review-created.event';

type CreatedEvent = RoundRatingCreatedEventV1 | RecruiterRatingCreatedEventV1 | OverallReviewCreatedEventV1;

const TOPICS = [ROUND_RATING_CREATED_V1_TOPIC, RECRUITER_RATING_CREATED_V1_TOPIC, OVERALL_REVIEW_CREATED_V1_TOPIC];

const TOPICS_BY_EVENT_TYPE = new Set<string>([
  'moderation.round_rating.created',
  'moderation.recruiter_rating.created',
  'moderation.overall_review.created',
]);

// Same interval class of value as api's DomainEventPublisher and
// notification-service's own NotificationConsumerService.
const RECONNECT_INTERVAL_MS = 30_000;

function entityIdFor(event: CreatedEvent): string {
  switch (event.eventType) {
    case 'moderation.round_rating.created':
      return event.roundRatingId;
    case 'moderation.recruiter_rating.created':
      return event.recruiterRatingId;
    case 'moderation.overall_review.created':
      return event.overallReviewId;
  }
}

// GitHub issue #339 (Phase 32) — the second real consumer of Phase 30's
// event bus (docs/EVENTS.md), in its own consumer group ('review-analyzer',
// independent of notification-service's — every consumer group gets its
// own copy of every message). Proves consumption of all three
// moderation.*.created.v1 topics end to end; deliberately does **not**
// call the LLM or write anything back yet — that's GitHub issue #340,
// which replaces this method's body with the actual Phase 19 (#163)
// triage logic and publishes moderation.<type>.verdict_computed.v1 per
// docs/DECISIONS.md D81. This service never subscribes to
// *.status_changed — its only job is analyzing newly created content.
//
// Connection handling mirrors notification-service's own
// NotificationConsumerService (GitHub issue #461's pattern): a lost or
// never-established broker connection must never crash-loop the whole
// service — onModuleInit()'s connect attempt is caught and logged, and
// retryConnectIfNeeded() keeps trying every RECONNECT_INTERVAL_MS until
// it succeeds.
@Injectable()
export class AnalysisConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalysisConsumerService.name);
  private connected = false;
  private destroyed = false;

  constructor(@Inject(EVENT_CONSUMER) private readonly consumer: Consumer) {}

  async onModuleInit(): Promise<void> {
    this.consumer.on(this.consumer.events.DISCONNECT, () => {
      this.connected = false;
    });
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (!this.connected) return;
    await this.consumer.disconnect().catch((err: unknown) => {
      this.logger.error('Failed to disconnect Redpanda consumer', err instanceof Error ? err.stack : err);
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
      await this.consumer.connect();
      await this.consumer.subscribe({ topics: TOPICS, fromBeginning: false });
      await this.consumer.run({
        eachMessage: (payload) => this.handleMessage(payload),
      });
      this.connected = true;
      if (wasDisconnected) {
        this.logger.log('Connected to Redpanda, consuming moderation.*.created.v1 topics');
      }
    } catch (err) {
      this.logger.error(
        'Failed to connect to Redpanda — no content will be analyzed until the broker recovers',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // Never throws — a malformed event or a transient failure anywhere in
  // this pipeline is caught and logged here, not left to kafkajs's default
  // retry-and-eventually-crash behavior, which would otherwise turn one
  // bad message into the whole consumer loop stalling. Same shape as
  // notification-service's own handleMessage().
  private async handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    let event: CreatedEvent;
    try {
      event = this.parseEvent(message.value.toString());
    } catch (err) {
      this.logger.error(
        `Malformed event on topic "${topic}" — skipping (offset still advances; a malformed message can never become well-formed on redelivery)`,
        err instanceof Error ? err.stack : err,
      );
      return;
    }

    try {
      await this.processEvent(event);
    } catch (err) {
      this.logger.error(
        `Failed to process "${event.eventType}" event for entity ${entityIdFor(event)} — will be retried on redelivery`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  private parseEvent(raw: string): CreatedEvent {
    const event = JSON.parse(raw) as CreatedEvent;
    if (!TOPICS_BY_EVENT_TYPE.has(event.eventType)) {
      throw new Error(`Unrecognized eventType "${String(event.eventType)}"`);
    }
    if (!event.candidateId) {
      throw new Error('Event is missing candidateId');
    }
    return event;
  }

  // Public — the actual per-event handling, deliberately separate from
  // handleMessage()'s kafkajs-shaped envelope so it's unit-testable
  // against a plain CreatedEvent object, no fake EachMessagePayload
  // required. Deliberately a log-only placeholder: GitHub issue #340 is
  // where this gains a real body (the LLM call, storing the verdict,
  // publishing verdict_computed) — this issue's scope is proving the
  // subscribe/parse/dispatch plumbing works, nothing more.
  processEvent(event: CreatedEvent): Promise<void> {
    this.logger.log(
      `Received ${event.eventType} for entity ${entityIdFor(event)} (candidate ${event.candidateId}) — analysis logic lands in GitHub issue #340`,
    );
    return Promise.resolve();
  }
}
