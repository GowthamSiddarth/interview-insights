import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import {
  MODERATION_QUEUE_SLA_BREACH_V1_TOPIC,
  ModerationQueueSlaBreachEventV1,
} from '../events/schemas/moderation-queue-sla-breach.event';
import {
  MODERATION_QUEUE_SLA_WARNING_V1_TOPIC,
  ModerationQueueSlaWarningEventV1,
} from '../events/schemas/moderation-queue-sla-warning.event';
import { getModerationSlaHours } from './moderation-sla.env';

interface BreachedEntry {
  id: string;
  entityType: ModerationQueueSlaBreachEventV1['entityType'];
  entityId: string;
  slaDeadline: Date;
  claimedById: string | null;
}

interface WarnableEntry {
  id: string;
  entityType: ModerationQueueSlaWarningEventV1['entityType'];
  entityId: string;
  slaDeadline: Date;
}

// GitHub issue #704 (Phase 51, D104) — warn once 75% of the SLA window
// has elapsed with no claimant yet (25% of the window still remaining
// until slaDeadline). A claimed entry never gets this warning — someone
// is already on it, per this issue's own scope; only the 100%-elapsed
// tier (notifyBreach() below) escalates further from there, and only
// for a still-unclaimed entry.
const SLA_WARNING_REMAINING_FRACTION = 0.25;

// GitHub issue #488 (Phase 36, D80) — a real scheduler, not the lazy
// self-heal-on-load pattern D69 used for the moderator search index: a
// breach must fire on its own, without anyone opening the queue.
// In-process via @nestjs/schedule, not a Kubernetes CronJob — same
// reasoning D72 already gave for the (now-ported-to-review-analyzer)
// reconciliation sweep: no existing cron/worker infra to justify the
// extra moving parts for a job this cheap at today's scale.
//
// GitHub issue #704 (Phase 51, D104) — extended with an earlier,
// 75%-elapsed-still-unclaimed warning tier (sweepWarnings()), broadcast
// to every active moderator (resolved by notification-service via
// StaffNotificationRecipientsService, not here — this service only ever
// publishes events, never resolves recipients itself, same separation
// every other publisher in this codebase already keeps). The existing
// 100%-elapsed breach tier (sweepBreaches()) is unchanged on this side;
// its own escalate-to-admins-when-unclaimed behavior lives entirely in
// notification-service's consumer.
@Injectable()
export class SlaBreachDetectionService {
  private readonly logger = new Logger(SlaBreachDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEventPublisher: DomainEventPublisher,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    await this.sweepWarnings();
    await this.sweepBreaches();
  }

  private async sweepWarnings(): Promise<void> {
    const slaWindowMs = getModerationSlaHours() * 60 * 60 * 1000;
    const now = new Date();
    const warningThreshold = new Date(now.getTime() + slaWindowMs * SLA_WARNING_REMAINING_FRACTION);

    const warnable = await this.prisma.moderationQueueEntry.findMany({
      where: {
        reviewedAt: null,
        claimedById: null,
        warningNotifiedAt: null,
        // Still before the real deadline (gt now) — once it passes,
        // this becomes sweepBreaches()'s own concern instead — and
        // within the warning window (lte warningThreshold, i.e. at
        // least 75% of the SLA window has already elapsed).
        slaDeadline: { gt: now, lte: warningThreshold },
      },
      select: { id: true, entityType: true, entityId: true, slaDeadline: true },
    });

    for (const entry of warnable) {
      await this.notifyWarning(entry);
    }
  }

  private async sweepBreaches(): Promise<void> {
    const breached = await this.prisma.moderationQueueEntry.findMany({
      where: { reviewedAt: null, breachNotifiedAt: null, slaDeadline: { lt: new Date() } },
      select: { id: true, entityType: true, entityId: true, slaDeadline: true, claimedById: true },
    });

    for (const entry of breached) {
      await this.notifyBreach(entry);
    }
  }

  private async notifyWarning(entry: WarnableEntry): Promise<void> {
    const event: ModerationQueueSlaWarningEventV1 = {
      eventType: 'moderation.queue.sla_warning',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      queueEntryId: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      slaDeadline: entry.slaDeadline.toISOString(),
    };
    await this.domainEventPublisher.publish(MODERATION_QUEUE_SLA_WARNING_V1_TOPIC, event, entry.id);

    // Same best-effort, stamp-regardless-of-publish-outcome contract as
    // notifyBreach()'s own breachNotifiedAt write below — see that
    // method's comment for the full reasoning.
    await this.prisma.moderationQueueEntry
      .update({ where: { id: entry.id }, data: { warningNotifiedAt: new Date() } })
      .catch((err: unknown) => {
        this.logger.error(
          `Failed to stamp warningNotifiedAt for queue entry ${entry.id} — it may be re-warned on the next sweep`,
          err instanceof Error ? err.stack : err,
        );
      });
  }

  private async notifyBreach(entry: BreachedEntry): Promise<void> {
    const event: ModerationQueueSlaBreachEventV1 = {
      eventType: 'moderation.queue.sla_breach',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      queueEntryId: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      slaDeadline: entry.slaDeadline.toISOString(),
      claimedById: entry.claimedById,
    };
    await this.domainEventPublisher.publish(MODERATION_QUEUE_SLA_BREACH_V1_TOPIC, event, entry.id);

    // Stamped regardless of whether the publish above actually reached the
    // broker: DomainEventPublisher.publish() is deliberately best-effort
    // (D16/D17/D53) and never surfaces a success/failure signal to its
    // caller — there is nothing here to condition on. The tradeoff this
    // accepts: a breach that occurs during a broker outage is
    // silently dropped once, not retried indefinitely on every later
    // sweep tick — the same "tried once, moved on" contract every other
    // domain event in this codebase already has, not a new gap #488
    // introduces.
    await this.prisma.moderationQueueEntry
      .update({ where: { id: entry.id }, data: { breachNotifiedAt: new Date() } })
      .catch((err: unknown) => {
        this.logger.error(
          `Failed to stamp breachNotifiedAt for queue entry ${entry.id} — it may be re-notified on the next sweep`,
          err instanceof Error ? err.stack : err,
        );
      });
  }
}
