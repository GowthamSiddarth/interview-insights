import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import {
  MODERATION_QUEUE_SLA_BREACH_V1_TOPIC,
  ModerationQueueSlaBreachEventV1,
} from '../events/schemas/moderation-queue-sla-breach.event';

interface BreachedEntry {
  id: string;
  entityType: ModerationQueueSlaBreachEventV1['entityType'];
  entityId: string;
  slaDeadline: Date;
  claimedById: string | null;
}

// GitHub issue #488 (Phase 36, D80) — a real scheduler, not the lazy
// self-heal-on-load pattern D69 used for the moderator search index: a
// breach must fire on its own, without anyone opening the queue.
// In-process via @nestjs/schedule, not a Kubernetes CronJob — same
// reasoning D72 already gave for the (now-ported-to-review-analyzer)
// reconciliation sweep: no existing cron/worker infra to justify the
// extra moving parts for a job this cheap at today's scale.
@Injectable()
export class SlaBreachDetectionService {
  private readonly logger = new Logger(SlaBreachDetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly domainEventPublisher: DomainEventPublisher,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const breached = await this.prisma.moderationQueueEntry.findMany({
      where: { reviewedAt: null, breachNotifiedAt: null, slaDeadline: { lt: new Date() } },
      select: { id: true, entityType: true, entityId: true, slaDeadline: true, claimedById: true },
    });

    for (const entry of breached) {
      await this.notifyBreach(entry);
    }
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
