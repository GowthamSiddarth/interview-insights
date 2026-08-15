import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ModerationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { decryptEmail } from '../candidates/email-encryption.util';
import { getEmailEncryptionKey } from './notification-consumer.service';
import { pendingReviewSubjectAndBody, subjectAndBodyFor } from './notification-templates.util';

// GitHub issue #711 (Phase 49, D104/D106) — mirrors review-analyzer's own
// ReconciliationSweepService (issue #442/#340, D81): a periodic sweep
// that closes the "lost/never-processed event" gap without a
// transactional outbox, covering both *.status_changed (D104's confirmed
// bug) and *.created (D106's documented scope) events. Shorter window
// than review-analyzer's 24h (which accounts for LLM retry latency) — a
// notification has no such latency once its trigger commits, so an hour
// is generous room for a broker hiccup or a consumer restart before
// treating one as genuinely missed.
const STALENESS_WINDOW_MS = 60 * 60 * 1000;

// status_changed rows are found via moderation_queue's own reviewedAt
// (naturally bounded: there are only ever as many rows as there are
// decisions), so no upper bound is needed there. created rows have no
// equivalent narrowing column — an entity's createdAt never changes and
// every row has one — so without an upper bound too, this half of the
// sweep would rescan this table's entire history every single hour
// forever. This window is deliberately generous (a day) relative to the
// 1h staleness floor: a *.created miss is a low-stakes "we got it"
// courtesy email (the consequential approve/reject email is the
// *.status_changed half, unboundedly covered), so a rare miss outside
// this 1h-25h band going unfixed is an accepted trade-off for keeping
// this query bounded.
const CREATED_SWEEP_MAX_AGE_MS = 25 * 60 * 60 * 1000;

type NotifiableEntityType = 'round_rating' | 'recruiter_rating' | 'overall_review';

const NOTIFIABLE_ENTITY_TYPES: readonly NotifiableEntityType[] = ['round_rating', 'recruiter_rating', 'overall_review'];

function statusChangedEventTypeFor(entityType: NotifiableEntityType): string {
  return `moderation.${entityType}.status_changed`;
}

function createdEventTypeFor(entityType: NotifiableEntityType): string {
  return `moderation.${entityType}.created`;
}

@Injectable()
export class ReconciliationSweepService {
  private readonly logger = new Logger(ReconciliationSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    await this.sweepStatusChanged();
    await this.sweepCreated();
  }

  private async sweepStatusChanged(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALENESS_WINDOW_MS);
    const staleEntries = await this.prisma.moderationQueueEntry.findMany({
      where: { reviewedAt: { not: null, lt: staleBefore } },
    });

    for (const entry of staleEntries) {
      await this.reconcileStatusChanged(entry.id, entry.entityType, entry.entityId);
    }
  }

  private async sweepCreated(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALENESS_WINDOW_MS);
    const veryStaleBefore = new Date(Date.now() - CREATED_SWEEP_MAX_AGE_MS);
    const window = { gte: veryStaleBefore, lt: staleBefore };

    for (const entityType of NOTIFIABLE_ENTITY_TYPES) {
      const rows = await this.findEntitiesCreatedInWindow(entityType, window);
      for (const row of rows) {
        await this.reconcileCreated(entityType, row.id, row.candidateId);
      }
    }
  }

  // Public — same "testable without the cron/kafkajs envelope" shape
  // api's ModerationService.publishCreatedEvent() and this service's own
  // NotificationConsumerService.processEvent() already use.
  async reconcileStatusChanged(moderationQueueEntryId: string, entityType: string, entityId: string): Promise<void> {
    if (!isNotifiableEntityType(entityType)) return; // 'company' — never notified, same as processEvent()'s own scope

    const eventType = statusChangedEventTypeFor(entityType);
    const alreadySent = await this.prisma.notificationLog.findUnique({
      where: { notification_log_dedup_key: { entityType, entityId, eventType, moderationQueueEntryId } },
    });
    if (alreadySent) return;

    const entity = await this.findEntity(entityType, entityId);
    if (!entity) return; // deleted since the queue entry was written — nothing left to notify about

    // Same as notificationFor()'s existing no-op for 'flagged'/'pending':
    // only a genuine approve/reject decision is notification-worthy.
    if (entity.status !== 'approved' && entity.status !== 'rejected') return;

    const candidate = await this.prisma.candidate.findUnique({ where: { id: entity.candidateId } });
    if (!candidate?.emailEncrypted) {
      this.logger.warn(`No email on file for candidate ${entity.candidateId} — cannot send reconciled notification`);
      return;
    }

    const email = decryptEmail(candidate.emailEncrypted, getEmailEncryptionKey());
    await this.mailService.send({ to: email, ...subjectAndBodyFor(entity.status) });

    this.logger.warn(
      `Reconciliation sweep sent a missed ${eventType} notification for ${entityType} ${entityId} (moderation_queue entry ${moderationQueueEntryId})`,
    );

    await this.recordSent(entityType, entityId, eventType, moderationQueueEntryId);
  }

  // Public, same reasoning as reconcileStatusChanged() above. No
  // moderation_queue entry involved — a *.created notification is keyed
  // per entity, same empty-string moderationQueueEntryId #687 already
  // established for this event shape.
  async reconcileCreated(entityType: NotifiableEntityType, entityId: string, candidateId: string): Promise<void> {
    const eventType = createdEventTypeFor(entityType);
    const alreadySent = await this.prisma.notificationLog.findUnique({
      where: { notification_log_dedup_key: { entityType, entityId, eventType, moderationQueueEntryId: '' } },
    });
    if (alreadySent) return;

    const candidate = await this.prisma.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate?.emailEncrypted) {
      this.logger.warn(`No email on file for candidate ${candidateId} — cannot send reconciled notification`);
      return;
    }

    const email = decryptEmail(candidate.emailEncrypted, getEmailEncryptionKey());
    await this.mailService.send({ to: email, ...pendingReviewSubjectAndBody() });

    this.logger.warn(`Reconciliation sweep sent a missed ${eventType} notification for ${entityType} ${entityId}`);

    await this.recordSent(entityType, entityId, eventType, '');
  }

  // Same after-send, swallow-P2002 shape as NotificationConsumerService's
  // own writes — a crash in the gap between send and this write can
  // still produce a duplicate email; the unique constraint only prevents
  // this row itself from ever being written twice.
  private async recordSent(
    entityType: string,
    entityId: string,
    eventType: string,
    moderationQueueEntryId: string,
  ): Promise<void> {
    await this.prisma.notificationLog
      .create({ data: { entityType, entityId, eventType, moderationQueueEntryId } })
      .catch((err: unknown) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return;
        }
        throw err;
      });
  }

  private async findEntity(
    entityType: NotifiableEntityType,
    entityId: string,
  ): Promise<{ candidateId: string; status: ModerationStatus } | null> {
    switch (entityType) {
      case 'round_rating':
        return this.prisma.roundRating.findUnique({
          where: { id: entityId },
          select: { candidateId: true, status: true },
        });
      case 'recruiter_rating':
        return this.prisma.recruiterRating.findUnique({
          where: { id: entityId },
          select: { candidateId: true, status: true },
        });
      case 'overall_review':
        return this.prisma.overallReview.findUnique({
          where: { id: entityId },
          select: { candidateId: true, status: true },
        });
    }
  }

  private async findEntitiesCreatedInWindow(
    entityType: NotifiableEntityType,
    window: { gte: Date; lt: Date },
  ): Promise<Array<{ id: string; candidateId: string }>> {
    const where = { createdAt: window };
    switch (entityType) {
      case 'round_rating':
        return this.prisma.roundRating.findMany({ where, select: { id: true, candidateId: true } });
      case 'recruiter_rating':
        return this.prisma.recruiterRating.findMany({ where, select: { id: true, candidateId: true } });
      case 'overall_review':
        return this.prisma.overallReview.findMany({ where, select: { id: true, candidateId: true } });
    }
  }
}

function isNotifiableEntityType(entityType: string): entityType is NotifiableEntityType {
  return entityType === 'round_rating' || entityType === 'recruiter_rating' || entityType === 'overall_review';
}
