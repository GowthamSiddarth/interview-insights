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
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { decryptEmail } from '../candidates/email-encryption.util';

type CreatedEvent = RoundRatingCreatedEventV1 | RecruiterRatingCreatedEventV1 | OverallReviewCreatedEventV1;

const TOPICS = [ROUND_RATING_CREATED_V1_TOPIC, RECRUITER_RATING_CREATED_V1_TOPIC, OVERALL_REVIEW_CREATED_V1_TOPIC];

// Same interval class of value as api's DomainEventPublisher.
const RECONNECT_INTERVAL_MS = 30_000;

function getEmailEncryptionKey(): string {
  const key = process.env.EMAIL_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('EMAIL_ENCRYPTION_KEY must be set to decrypt a candidate email to notify.');
  }
  return key;
}

function entityTypeFor(event: CreatedEvent): string {
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

// GitHub issue #335 (Phase 31) — the first real consumer of Phase 30's
// event bus (docs/EVENTS.md). Subscribes to all three moderation.*.created.v1
// topics and sends a "your submission is pending review" email per event,
// idempotently.
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
      if (wasDisconnected) this.logger.log('Connected to Redpanda, consuming moderation.*.created.v1 topics');
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

  // Public — the actual per-event business logic, deliberately separate
  // from handleMessage()'s kafkajs-shaped envelope so it's unit-testable
  // against a plain CreatedEvent object, no fake EachMessagePayload
  // required. Same "keep the testable logic in a public method" shape
  // api's ModerationService.publishCreatedEvent() already uses.
  async processEvent(event: CreatedEvent): Promise<void> {
    const entityType = entityTypeFor(event);
    const entityId = entityIdFor(event);

    // Idempotency (issue #335's own acceptance criteria): a redelivered
    // event must never send a duplicate email. Checked up front so the
    // common redelivery-of-an-already-handled-event path never re-sends;
    // the create() below is the actual race-safe guard (a unique
    // constraint, not this check) for the narrow window where a crash
    // happens between a successful send and this row being written.
    const alreadySent = await this.prisma.notificationLog.findUnique({
      where: { entityType_entityId_eventType: { entityType, entityId, eventType: event.eventType } },
    });
    if (alreadySent) {
      this.logger.log(`Already sent a pending-review email for ${event.eventType}:${entityId} — skipping duplicate`);
      return;
    }

    const candidate = await this.prisma.candidate.findUnique({ where: { id: event.candidateId } });
    if (!candidate?.emailEncrypted) {
      this.logger.warn(`No email on file for candidate ${event.candidateId} — cannot send pending-review notification`);
      return;
    }

    const email = decryptEmail(candidate.emailEncrypted, getEmailEncryptionKey());

    await this.mailService.send({
      to: email,
      subject: 'Your submission is pending review',
      text: "Thanks for your submission! It's now in our moderation queue and will be reviewed shortly.",
      html: "<p>Thanks for your submission! It's now in our moderation queue and will be reviewed shortly.</p>",
    });

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
      .create({ data: { entityType, entityId, eventType: event.eventType } })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return;
        }
        throw err;
      });
  }
}

const TOPICS_BY_EVENT_TYPE = new Set<string>([
  'moderation.round_rating.created',
  'moderation.recruiter_rating.created',
  'moderation.overall_review.created',
]);
