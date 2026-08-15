import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Consumer, EachMessagePayload } from 'kafkajs';
import { Prisma } from '@prisma/client';
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
import {
  ROUND_RATING_STATUS_CHANGED_V1_TOPIC,
  RoundRatingStatusChangedEventV1,
} from '../events/schemas/round-rating-status-changed.event';
import {
  RECRUITER_RATING_STATUS_CHANGED_V1_TOPIC,
  RecruiterRatingStatusChangedEventV1,
} from '../events/schemas/recruiter-rating-status-changed.event';
import {
  OVERALL_REVIEW_STATUS_CHANGED_V1_TOPIC,
  OverallReviewStatusChangedEventV1,
} from '../events/schemas/overall-review-status-changed.event';
import {
  COMPANY_CREATED_V1_TOPIC,
  CompanyCreatedEventV1,
} from '../events/schemas/company-created.event';
import {
  COMPANY_STATUS_CHANGED_V1_TOPIC,
  CompanyStatusChangedEventV1,
} from '../events/schemas/company-status-changed.event';
import {
  MODERATION_QUEUE_SLA_BREACH_V1_TOPIC,
  ModerationQueueSlaBreachEventV1,
} from '../events/schemas/moderation-queue-sla-breach.event';
import {
  MODERATION_QUEUE_SLA_WARNING_V1_TOPIC,
  ModerationQueueSlaWarningEventV1,
} from '../events/schemas/moderation-queue-sla-warning.event';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { decryptEmail } from '../candidates/email-encryption.util';
import { pendingReviewSubjectAndBody, subjectAndBodyFor } from './notification-templates.util';
import { StaffNotificationRecipientsService } from './staff-notification-recipients.service';

// GitHub issue #698 (Phase 50, D104) — company joins the three original
// rated/reviewed entity types here. Its events have no companyId field
// of their own (the entity *is* the company), so it's structurally
// identical to the other three for everything below except
// entityTypeFor()/entityIdFor()'s own switches.
type CreatedEvent =
  | RoundRatingCreatedEventV1
  | RecruiterRatingCreatedEventV1
  | OverallReviewCreatedEventV1
  | CompanyCreatedEventV1;
type StatusChangedEvent =
  | RoundRatingStatusChangedEventV1
  | RecruiterRatingStatusChangedEventV1
  | OverallReviewStatusChangedEventV1
  | CompanyStatusChangedEventV1;
// GitHub issue #489 (Phase 36) — a third, structurally different kind of
// event: no candidateId (nothing here is candidate-facing), and its
// recipient is resolved via claimedById -> Moderator.email, not a
// decrypted Candidate email. processEvent() branches on eventType before
// any of the candidateId-shaped logic below ever runs against it.
//
// GitHub issue #704 (Phase 51, D104) — sla_warning joins sla_breach as
// the same structurally-different kind of event (no candidateId), but
// its own recipient resolution is a broadcast (StaffNotificationRecipientsService)
// rather than a single claimedById lookup — see processSlaWarningEvent().
type ModerationEvent =
  | CreatedEvent
  | StatusChangedEvent
  | ModerationQueueSlaBreachEventV1
  | ModerationQueueSlaWarningEventV1;

const TOPICS = [
  ROUND_RATING_CREATED_V1_TOPIC,
  RECRUITER_RATING_CREATED_V1_TOPIC,
  OVERALL_REVIEW_CREATED_V1_TOPIC,
  COMPANY_CREATED_V1_TOPIC,
  ROUND_RATING_STATUS_CHANGED_V1_TOPIC,
  RECRUITER_RATING_STATUS_CHANGED_V1_TOPIC,
  OVERALL_REVIEW_STATUS_CHANGED_V1_TOPIC,
  COMPANY_STATUS_CHANGED_V1_TOPIC,
  MODERATION_QUEUE_SLA_BREACH_V1_TOPIC,
  MODERATION_QUEUE_SLA_WARNING_V1_TOPIC,
];

// Same interval class of value as api's DomainEventPublisher.
const RECONNECT_INTERVAL_MS = 30_000;

// Exported so ReconciliationSweepService (GitHub issue #711) can decrypt
// a candidate email too, without duplicating this env-read.
export function getEmailEncryptionKey(): string {
  const key = process.env.EMAIL_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('EMAIL_ENCRYPTION_KEY must be set to decrypt a candidate email to notify.');
  }
  return key;
}

function entityTypeFor(event: ModerationEvent): string {
  switch (event.eventType) {
    case 'moderation.round_rating.created':
    case 'moderation.round_rating.status_changed':
      return 'round_rating';
    case 'moderation.recruiter_rating.created':
    case 'moderation.recruiter_rating.status_changed':
      return 'recruiter_rating';
    case 'moderation.overall_review.created':
    case 'moderation.overall_review.status_changed':
      return 'overall_review';
    // GitHub issue #698 (Phase 50, D104) — company joins the other three
    // rated/reviewed entity types.
    case 'moderation.company.created':
    case 'moderation.company.status_changed':
      return 'company';
    // Not one of the four entity types above — these two events are
    // about the moderation_queue row itself, not the entity they wrap
    // (that's carried separately, as event.entityType/entityId).
    case 'moderation.queue.sla_breach':
    case 'moderation.queue.sla_warning':
      return 'moderation_queue';
  }
}

function entityIdFor(event: ModerationEvent): string {
  switch (event.eventType) {
    case 'moderation.round_rating.created':
    case 'moderation.round_rating.status_changed':
      return event.roundRatingId;
    case 'moderation.recruiter_rating.created':
    case 'moderation.recruiter_rating.status_changed':
      return event.recruiterRatingId;
    case 'moderation.overall_review.created':
    case 'moderation.overall_review.status_changed':
      return event.overallReviewId;
    case 'moderation.company.created':
    case 'moderation.company.status_changed':
      return event.companyId;
    case 'moderation.queue.sla_breach':
    case 'moderation.queue.sla_warning':
      return event.queueEntryId;
  }
}

function isCreatedEvent(event: ModerationEvent): event is CreatedEvent {
  return event.eventType.endsWith('.created');
}

// GitHub issue #687 (Phase 49, D104) — the confirmed-bug fix: a
// resubmission (reenqueue()) creates a fresh moderation_queue row for
// the same entityId, so a status_changed event's decision must be
// deduped per queue entry, not per entity. Empty string for a
// non-resubmission `created` event (fires once per entity — entityId+
// eventType is already unique on its own) and for `sla_breach` (its
// entityId already *is* the queue entry id, see entityIdFor() above).
//
// GitHub issue #692 (Phase 49, D104) — a *resubmission* `created` event
// (isResubmission: true) is the one exception: it fires a second time
// for the same entityId, so it needs the same per-queue-entry dedup
// status_changed already gets, keyed off the fresh moderationQueueEntryId
// api's ModerationService.publishCreatedEvent() now includes for that
// case. This can never collide with the original submission's dedup row
// (still keyed '') since a real queue entry id is never the empty string.
function moderationQueueEntryIdFor(event: ModerationEvent): string {
  if (isStatusChangedEvent(event)) return event.moderationQueueEntryId ?? '';
  if (isCreatedEvent(event) && event.isResubmission) return event.moderationQueueEntryId ?? '';
  return '';
}

// GitHub issue #489 — the one fixed template for an SLA breach, same
// "two fixed templates, nothing more generic" scope D73 already
// described this service's mail-sending needs as having.
function slaBreachSubjectAndBody(): { subject: string; text: string; html: string } {
  return {
    subject: 'A moderation queue item you claimed is overdue',
    text: 'A moderation queue item you claimed has passed its SLA deadline and still needs review.',
    html: '<p>A moderation queue item you claimed has passed its SLA deadline and still needs review.</p>',
  };
}

// GitHub issue #704 (Phase 51, D104) — the warning tier's own fixed
// template, broadcast rather than addressed to a specific claimant (the
// body deliberately doesn't say "you claimed" — no one has yet).
function slaWarningSubjectAndBody(): { subject: string; text: string; html: string } {
  return {
    subject: 'A moderation queue item is nearing its SLA deadline',
    text: 'An unclaimed moderation queue item is nearing its SLA deadline and still needs a moderator to claim it.',
    html: '<p>An unclaimed moderation queue item is nearing its SLA deadline and still needs a moderator to claim it.</p>',
  };
}

// GitHub issue #335 (Phase 31) — the first real consumer of Phase 30's
// event bus (docs/EVENTS.md). Subscribes to all three moderation.*.created.v1
// topics and sends a "your submission is pending review" email per event,
// idempotently. GitHub issue #336 extended the same consumer (same
// consumer group, same idempotency plumbing) to also subscribe to the
// three moderation.*.status_changed.v1 topics and send an
// approved/rejected email — see notificationFor()'s own handling of
// 'flagged' as the one status with no email.
//
// Connection handling mirrors api's DomainEventPublisher (GitHub issue
// #461): a lost or never-established broker connection must never
// crash-loop the whole service (issue #335's own acceptance criteria) —
// onModuleInit()'s connect attempt is caught and logged, and
// retryConnectIfNeeded() keeps trying every RECONNECT_INTERVAL_MS until
// it succeeds, whether the broker was never reachable at boot or dropped
// out later.
@Injectable()
export class NotificationConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationConsumerService.name);
  private connected = false;
  private destroyed = false;

  constructor(
    @Inject(EVENT_CONSUMER) private readonly consumer: Consumer,
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly staffNotificationRecipients: StaffNotificationRecipientsService,
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
        this.logger.log('Connected to Redpanda, consuming moderation.*.created.v1, moderation.*.status_changed.v1, moderation.queue.sla_breach.v1, and moderation.queue.sla_warning.v1 topics');
      }
    } catch (err) {
      this.logger.error(
        'Failed to connect to Redpanda — no pending-review notifications will be sent until the broker recovers',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // Never throws — a malformed event or a transient failure anywhere in
  // this pipeline (issue #335's own acceptance criteria) is caught and
  // logged here, not left to kafkajs's default retry-and-eventually-crash
  // behavior, which would otherwise turn one bad message into the whole
  // consumer loop stalling.
  private async handleMessage({ topic, message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    let event: ModerationEvent;
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

  private parseEvent(raw: string): ModerationEvent {
    const event = JSON.parse(raw) as ModerationEvent;
    if (!TOPICS_BY_EVENT_TYPE.has(event.eventType)) {
      throw new Error(`Unrecognized eventType "${String(event.eventType)}"`);
    }
    // GitHub issue #489 — a sla_breach event has no candidateId at all
    // (nothing about it is candidate-facing); the check below only
    // applies to the event shapes that do carry one. GitHub issue #704 —
    // sla_warning is the same "no candidateId at all" shape. The `!==`
    // guards narrow `event` for the `&&`'s second operand, same as any
    // other discriminated-union check.
    if (
      event.eventType !== 'moderation.queue.sla_breach' &&
      event.eventType !== 'moderation.queue.sla_warning' &&
      !event.candidateId
    ) {
      throw new Error('Event is missing candidateId');
    }
    return event;
  }

  // Public — the actual per-event business logic, deliberately separate
  // from handleMessage()'s kafkajs-shaped envelope so it's unit-testable
  // against a plain ModerationEvent object, no fake EachMessagePayload
  // required. Same "keep the testable logic in a public method" shape
  // api's ModerationService.publishCreatedEvent() already uses.
  async processEvent(event: ModerationEvent): Promise<void> {
    // GitHub issue #489 — structurally a different kind of event (no
    // candidateId, a different recipient-resolution path) — branches off
    // before any of the candidateId-shaped logic below, which never runs
    // against it.
    if (event.eventType === 'moderation.queue.sla_breach') {
      return this.processSlaBreachEvent(event);
    }
    if (event.eventType === 'moderation.queue.sla_warning') {
      return this.processSlaWarningEvent(event);
    }

    // 'flagged' (GitHub issue #336): the issue/ROADMAP scope is explicitly
    // "approved/rejected notification" — flagged has no corresponding
    // email. No NotificationLog row is written for it either: with no
    // side effect to dedupe, there's nothing idempotency needs to guard —
    // api's ModerationService.review() rejects re-reviewing an entry that
    // already has reviewedAt set, so this is a true no-op, not a decision
    // that a later event could still need to build on.
    const notification = notificationFor(event);
    if (!notification) {
      this.logger.log(`No notification for ${event.eventType}:${entityIdFor(event)} (newStatus is 'flagged') — skipping`);
      return;
    }

    const entityType = entityTypeFor(event);
    const entityId = entityIdFor(event);
    const moderationQueueEntryId = moderationQueueEntryIdFor(event);

    // Idempotency (issue #335's own acceptance criteria, extended to
    // status_changed by #336; keyed per moderation_queue entry since
    // #687 to also cover resubmissions correctly). Checked up front so
    // the common redelivery-of-an-already-handled-event path never
    // re-sends; the create() below is the actual race-safe guard (a
    // unique constraint, not this check) for the narrow window where a
    // crash happens between a successful send and this row being
    // written.
    const alreadySent = await this.prisma.notificationLog.findUnique({
      where: { notification_log_dedup_key: { entityType, entityId, eventType: event.eventType, moderationQueueEntryId } },
    });
    if (alreadySent) {
      this.logger.log(`Already sent a notification for ${event.eventType}:${entityId} — skipping duplicate`);
      return;
    }

    const candidate = await this.prisma.candidate.findUnique({ where: { id: event.candidateId } });
    if (!candidate?.emailEncrypted) {
      this.logger.warn(`No email on file for candidate ${event.candidateId} — cannot send notification`);
      return;
    }

    const email = decryptEmail(candidate.emailEncrypted, getEmailEncryptionKey());

    await this.mailService.send({ to: email, ...notification });

    // Recorded only after a successful send, not before: marking this
    // "done" ahead of the send would mean a transient SMTP error (issue
    // #335's own example) permanently suppresses a notification that was
    // never actually delivered. Written right after the send instead of
    // wrapped in a transaction with it (email delivery and a Postgres
    // write can't share one) — a crash in the narrow gap between the two
    // can still produce a duplicate email; the unique constraint here
    // only prevents this row itself from ever being written twice, which
    // is what keeps every *other* redelivery (the common case) a no-op.
    await this.prisma.notificationLog
      .create({ data: { entityType, entityId, eventType: event.eventType, moderationQueueEntryId } })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return;
        }
        throw err;
      });
  }

  // GitHub issue #489 — recipient is the claiming moderator (resolved via
  // this service's own minimal Moderator mirror, D75 pattern), not a
  // decrypted candidate email. Same idempotency shape as processEvent()'s
  // own guard, keyed the same way (entityTypeFor/entityIdFor already
  // handle 'moderation.queue.sla_breach' — see their own comments).
  //
  // GitHub issue #704 (Phase 51, D104) — an *unclaimed* breach no longer
  // means "no recipient." Under this phase's manual-claim-only model
  // (D80) there's still no auto-assignment, but leaving a breached,
  // unclaimed item silently unnotified forever was the actual gap this
  // issue closes: it now escalates to every active admin instead —
  // resolved by StaffNotificationRecipientsService (#703), never by this
  // service reaching back into api. The idempotency check moved ahead of
  // the claimed/unclaimed branch so it applies uniformly to both paths.
  private async processSlaBreachEvent(event: ModerationQueueSlaBreachEventV1): Promise<void> {
    const entityType = entityTypeFor(event);
    const entityId = entityIdFor(event);
    const moderationQueueEntryId = moderationQueueEntryIdFor(event);

    const alreadySent = await this.prisma.notificationLog.findUnique({
      where: { notification_log_dedup_key: { entityType, entityId, eventType: event.eventType, moderationQueueEntryId } },
    });
    if (alreadySent) {
      this.logger.log(`Already sent an SLA breach notification for queue entry ${entityId} — skipping duplicate`);
      return;
    }

    const recipients = event.claimedById
      ? await this.resolveClaimantEmail(event.claimedById)
      : await this.staffNotificationRecipients.activeAdminEmails();

    if (recipients.length === 0) {
      this.logger.warn(
        event.claimedById
          ? `No moderator found for id ${event.claimedById} — cannot send SLA breach notification`
          : `SLA breach for queue entry ${event.queueEntryId} has no claimant and no active admins to escalate to — skipping`,
      );
      return;
    }

    await Promise.all(recipients.map((email) => this.mailService.send({ to: email, ...slaBreachSubjectAndBody() })));

    await this.prisma.notificationLog
      .create({ data: { entityType, entityId, eventType: event.eventType, moderationQueueEntryId } })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return;
        }
        throw err;
      });
  }

  private async resolveClaimantEmail(claimedById: string): Promise<string[]> {
    const moderator = await this.prisma.moderator.findUnique({ where: { id: claimedById } });
    return moderator ? [moderator.email] : [];
  }

  // GitHub issue #704 (Phase 51, D104) — the new 75%-elapsed-still-
  // unclaimed tier, broadcast to every active moderator (both
  // `moderator` and `admin` roles — StaffNotificationRecipientsService's
  // own comment for why) rather than the single claimant sla_breach.v1
  // targets. Same idempotency/best-effort shape as processSlaBreachEvent().
  private async processSlaWarningEvent(event: ModerationQueueSlaWarningEventV1): Promise<void> {
    const entityType = entityTypeFor(event);
    const entityId = entityIdFor(event);
    const moderationQueueEntryId = moderationQueueEntryIdFor(event);

    const alreadySent = await this.prisma.notificationLog.findUnique({
      where: { notification_log_dedup_key: { entityType, entityId, eventType: event.eventType, moderationQueueEntryId } },
    });
    if (alreadySent) {
      this.logger.log(`Already sent an SLA warning notification for queue entry ${entityId} — skipping duplicate`);
      return;
    }

    const recipients = await this.staffNotificationRecipients.activeModeratorEmails();
    if (recipients.length === 0) {
      this.logger.warn(
        `SLA warning for queue entry ${event.queueEntryId} has no active moderators to notify — skipping`,
      );
      return;
    }

    await Promise.all(recipients.map((email) => this.mailService.send({ to: email, ...slaWarningSubjectAndBody() })));

    await this.prisma.notificationLog
      .create({ data: { entityType, entityId, eventType: event.eventType, moderationQueueEntryId } })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return;
        }
        throw err;
      });
  }
}

function isStatusChangedEvent(event: ModerationEvent): event is StatusChangedEvent {
  return event.eventType.endsWith('.status_changed');
}

// The notification content for an event, or null when the event is a
// deliberate no-op (a 'flagged' status_changed — see processEvent's own
// comment).
function notificationFor(event: ModerationEvent): { subject: string; text: string; html: string } | null {
  if (isCreatedEvent(event)) {
    // GitHub issue #692 (Phase 49, D104) — a distinct subject/body for a
    // resubmission ack vs. a first-time "pending review" email.
    return pendingReviewSubjectAndBody(event.isResubmission ?? false);
  }
  if (isStatusChangedEvent(event) && (event.newStatus === 'approved' || event.newStatus === 'rejected')) {
    return subjectAndBodyFor(event.newStatus);
  }
  return null;
}

const TOPICS_BY_EVENT_TYPE = new Set<string>([
  'moderation.round_rating.created',
  'moderation.recruiter_rating.created',
  'moderation.overall_review.created',
  'moderation.company.created',
  'moderation.round_rating.status_changed',
  'moderation.recruiter_rating.status_changed',
  'moderation.overall_review.status_changed',
  'moderation.company.status_changed',
  'moderation.queue.sla_breach',
  'moderation.queue.sla_warning',
]);
