import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ModerationEntityType, Prisma } from '@prisma/client';
import { EVENT_CONSUMER } from '../events/redpanda-client.provider';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import {
  ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC,
  RoundRatingVerdictComputedEventV1,
} from '../events/schemas/round-rating-verdict-computed.event';
import {
  RECRUITER_RATING_VERDICT_COMPUTED_V1_TOPIC,
  RecruiterRatingVerdictComputedEventV1,
} from '../events/schemas/recruiter-rating-verdict-computed.event';
import {
  OVERALL_REVIEW_VERDICT_COMPUTED_V1_TOPIC,
  OverallReviewVerdictComputedEventV1,
} from '../events/schemas/overall-review-verdict-computed.event';
import {
  BaseVerdictComputedEventDto,
  OverallReviewVerdictComputedEventDto,
  RecruiterRatingVerdictComputedEventDto,
  RoundRatingVerdictComputedEventDto,
} from './dto/verdict-computed-event.dto';

type VerdictComputedEvent =
  | RoundRatingVerdictComputedEventV1
  | RecruiterRatingVerdictComputedEventV1
  | OverallReviewVerdictComputedEventV1;

type TriageableEntityType = Exclude<ModerationEntityType, 'company'>;

const TOPICS = [
  ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC,
  RECRUITER_RATING_VERDICT_COMPUTED_V1_TOPIC,
  OVERALL_REVIEW_VERDICT_COMPUTED_V1_TOPIC,
];

const TOPICS_BY_EVENT_TYPE = new Set<string>([
  'moderation.round_rating.verdict_computed',
  'moderation.recruiter_rating.verdict_computed',
  'moderation.overall_review.verdict_computed',
]);

// GitHub issue #782 (Phase 52) — one DTO class per eventType, dispatched
// on the same discriminant TOPICS_BY_EVENT_TYPE already checks.
const DTO_BY_EVENT_TYPE = {
  'moderation.round_rating.verdict_computed': RoundRatingVerdictComputedEventDto,
  'moderation.recruiter_rating.verdict_computed': RecruiterRatingVerdictComputedEventDto,
  'moderation.overall_review.verdict_computed': OverallReviewVerdictComputedEventDto,
} as const;

const RECONNECT_INTERVAL_MS = 30_000;

// GitHub issue #440 (Phase 39, D71) — same fixed system-actor label
// AiModerationService used to carry, now attributed here instead.
export const AUTO_APPROVAL_SYSTEM_ACTOR = 'system:ai-auto-approval';
// GitHub issue #442 (Phase 39, D71) — same actor the reconciliation sweep
// (now in review-analyzer, GitHub issue #340) used to carry when escalating
// a stalled row directly; this is the one place that still calls flag().
export const RECONCILIATION_SWEEP_SYSTEM_ACTOR = 'system:ai-reconciliation-sweep';

// GitHub issue #782 (Phase 52) — exported (not a class method) so it's
// unit-testable in isolation, same reasoning as entityTypeFor/entityIdFor
// below. Validates the parsed JSON against the DTO matching its eventType
// before it's trusted anywhere downstream (a Prisma update, moderation
// approval/flag) — see verdict-computed-event.dto.ts for what's checked.
export function parseVerdictComputedEvent(raw: string): VerdictComputedEvent {
  const parsed = JSON.parse(raw) as { eventType?: unknown };
  const eventType = parsed.eventType;
  if (typeof eventType !== 'string' || !TOPICS_BY_EVENT_TYPE.has(eventType)) {
    throw new Error(`Unrecognized eventType "${String(eventType)}"`);
  }

  const dtoClass = DTO_BY_EVENT_TYPE[eventType as keyof typeof DTO_BY_EVENT_TYPE] as new () =>
    BaseVerdictComputedEventDto;
  const instance = plainToInstance(dtoClass, parsed);
  const errors = validateSync(instance);
  if (errors.length > 0) {
    throw new Error(`Event failed schema validation: ${errors.map((e) => e.toString()).join('; ')}`);
  }
  return instance as unknown as VerdictComputedEvent;
}

function entityTypeFor(event: VerdictComputedEvent): TriageableEntityType {
  switch (event.eventType) {
    case 'moderation.round_rating.verdict_computed':
      return 'round_rating';
    case 'moderation.recruiter_rating.verdict_computed':
      return 'recruiter_rating';
    case 'moderation.overall_review.verdict_computed':
      return 'overall_review';
  }
}

function entityIdFor(event: VerdictComputedEvent): string {
  switch (event.eventType) {
    case 'moderation.round_rating.verdict_computed':
      return event.roundRatingId;
    case 'moderation.recruiter_rating.verdict_computed':
      return event.recruiterRatingId;
    case 'moderation.overall_review.verdict_computed':
      return event.overallReviewId;
  }
}

// GitHub issue #340 (Phase 32, D81) — api's first-ever event consumer.
// review-analyzer computes the LLM verdict async and publishes it here;
// this service applies it — writing moderationVerdict, then either running
// the existing (D71) approveWithAudit() auto-approval flow or, for a
// review-analyzer reconciliation-sweep escalation (`stalled: true`),
// calling ModerationService.flag() — same as AiModerationService/
// ReconciliationSweepService used to do in-process before this issue moved
// the LLM call itself out to review-analyzer. review-analyzer never calls
// approve()/flag() itself or touches moderation_queue (D81) — that decision
// stays entirely in this service, keeping hard constraint #2 intact.
//
// Connection handling mirrors notification-service's/review-analyzer's own
// consumers (GitHub issue #461's pattern): a lost or never-established
// broker connection must never crash-loop the whole app.
@Injectable()
export class VerdictConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VerdictConsumerService.name);
  private connected = false;
  private destroyed = false;

  constructor(
    @Inject(EVENT_CONSUMER) private readonly consumer: Consumer,
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
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
        this.logger.log('Connected to Redpanda, consuming moderation.*.verdict_computed.v1 topics');
      }
    } catch (err) {
      this.logger.error(
        'Failed to connect to Redpanda — no verdicts will be applied until the broker recovers',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  private async handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    let event: VerdictComputedEvent;
    try {
      event = parseVerdictComputedEvent(message.value.toString());
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

  // Public — the actual per-event handling, deliberately separate from
  // handleMessage()'s kafkajs-shaped envelope so it's unit-testable against
  // a plain VerdictComputedEvent object.
  async processEvent(event: VerdictComputedEvent): Promise<void> {
    const entityType = entityTypeFor(event);
    const entityId = entityIdFor(event);

    if (event.stalled === true) {
      await this.escalateStalled(entityType, entityId);
      return;
    }

    await this.storeVerdict(entityType, entityId, event.verdict ?? {});

    if (event.autoApprovalEligible) {
      await this.autoApprove(entityType, entityId, event);
    }
  }

  private async storeVerdict(
    entityType: TriageableEntityType,
    entityId: string,
    verdict: Record<string, unknown>,
  ): Promise<void> {
    const data = { moderationVerdict: verdict as Prisma.InputJsonObject };
    switch (entityType) {
      case 'round_rating':
        await this.prisma.roundRating.update({ where: { id: entityId }, data });
        break;
      case 'recruiter_rating':
        await this.prisma.recruiterRating.update({ where: { id: entityId }, data });
        break;
      case 'overall_review':
        await this.prisma.overallReview.update({ where: { id: entityId }, data });
        break;
    }
  }

  // GitHub issue #440 (Phase 39, D71) — looks up the pending moderation_queue
  // entry every write path already created, and routes it through the exact
  // same ModerationService.approve() a human moderator's own action already
  // calls, attributed to a fixed system actor.
  private async autoApprove(
    entityType: TriageableEntityType,
    entityId: string,
    event: VerdictComputedEvent,
  ): Promise<void> {
    const queueEntry = await this.prisma.moderationQueueEntry.findFirst({
      where: { entityType, entityId, reviewedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!queueEntry) {
      this.logger.warn(
        `Auto-approval eligible for ${entityType} ${entityId} but no pending moderation queue entry was found — leaving it advisory-only`,
      );
      return;
    }

    // GitHub issue #689 (Phase 49, D104) — an escalated entry (a
    // resubmission past the lifetime cap) needs a human admin's
    // judgment, not another automated pass. Same "leave it advisory-
    // only" outcome as the no-queue-entry case above — the verdict was
    // already persisted by handleVerdictComputed() before this method
    // ever runs, so nothing is lost by not auto-approving.
    if (queueEntry.escalated) {
      this.logger.warn(
        `Auto-approval eligible for ${entityType} ${entityId} but its moderation queue entry is escalated — leaving it advisory-only for admin review`,
      );
      return;
    }

    await this.moderationService.approveWithAudit(
      queueEntry.id,
      { reviewedBy: AUTO_APPROVAL_SYSTEM_ACTOR },
      {
        entityType,
        entityId,
        promptContent: event.promptContent ?? '',
        responseText: event.responseText ?? '',
        verdict: (event.verdict ?? {}) as Prisma.InputJsonValue,
        confidence: event.confidence ?? 0,
        model: event.model ?? '',
      },
    );
  }

  // GitHub issue #442 (Phase 39, D71) — routes through the same
  // ModerationService.flag() a human moderator's own flag click already
  // calls, attributed to a distinct system actor and a dedicated flag
  // reason, same as the reconciliation sweep did in-process before it moved
  // to review-analyzer (GitHub issue #340).
  private async escalateStalled(entityType: TriageableEntityType, entityId: string): Promise<void> {
    const queueEntry = await this.prisma.moderationQueueEntry.findFirst({
      where: { entityType, entityId, reviewedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!queueEntry) {
      this.logger.warn(
        `Reconciliation sweep found a stalled ${entityType} ${entityId} but no pending moderation queue entry to flag`,
      );
      return;
    }

    await this.moderationService.flag(queueEntry.id, {
      reviewedBy: RECONCILIATION_SWEEP_SYSTEM_ACTOR,
      flagReason: 'ai_triage_stalled',
    });
  }
}
