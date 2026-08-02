import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { EVENT_CONSUMER } from '../events/redpanda-client.provider';
import { VerdictPublisher } from '../events/verdict-publisher.service';
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
import { AnalysisService, TriageableEntityType } from './analysis.service';
import { buildVerdictComputedEvent } from './verdict-event.util';

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

function entityTypeFor(event: CreatedEvent): TriageableEntityType {
  switch (event.eventType) {
    case 'moderation.round_rating.created':
      return 'round_rating';
    case 'moderation.recruiter_rating.created':
      return 'recruiter_rating';
    case 'moderation.overall_review.created':
      return 'overall_review';
  }
}

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
// own copy of every message). GitHub issue #340 (D81) gave processEvent()
// its real body: compute the verdict (AnalysisService, ported from api's
// old in-process AiModerationService) and publish
// moderation.<type>.verdict_computed.v1 — this service never writes
// anything back to Postgres or moderation_queue itself. This service never
// subscribes to *.status_changed — its only job is analyzing newly created
// content.
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

  constructor(
    @Inject(EVENT_CONSUMER) private readonly consumer: Consumer,
    private readonly analysisService: AnalysisService,
    private readonly verdictPublisher: VerdictPublisher,
  ) {}

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
  // handleMessage()'s kafkajs-shaped envelope so it's unit-testable against
  // a plain CreatedEvent object, no fake EachMessagePayload required.
  // Computes the verdict and publishes it; a disabled feature, a gone
  // entity, or a failed/refused LLM call all resolve to computeVerdict()
  // returning null (logged inside AnalysisService already) — nothing is
  // published in that case, same as the old in-process path leaving
  // moderationVerdict untouched.
  async processEvent(event: CreatedEvent): Promise<void> {
    const entityType = entityTypeFor(event);
    const entityId = entityIdFor(event);

    const result = await this.analysisService.computeVerdict(entityType, entityId);
    if (!result) return;

    const { topic, event: verdictEvent } = buildVerdictComputedEvent(entityType, entityId, result);
    await this.verdictPublisher.publish(topic, verdictEvent, entityId);
  }
}
