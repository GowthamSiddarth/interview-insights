import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ModerationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VerdictPublisher } from '../events/verdict-publisher.service';
import { AnalysisService, TriageableEntityType } from './analysis.service';
import { buildVerdictComputedEvent } from './verdict-event.util';
import { isAiModerationEnabled } from './ai-moderation.env';

// GitHub issue #442 (Phase 39, D71), ported here by GitHub issue #340
// (Phase 32, D81) — same 24h staleness window as api's original
// ReconciliationSweepService.
const STALENESS_WINDOW_MS = 24 * 60 * 60 * 1000;

const TRIAGEABLE_ENTITY_TYPES: readonly TriageableEntityType[] = [
  'round_rating',
  'recruiter_rating',
  'overall_review',
];

// Closes the "lost/never-ran triage" gap without a transactional outbox —
// same reasoning as api's original ReconciliationSweepService, ported here
// since this service is now the only place the LLM is ever called from
// (D81). One real difference from the original: that version escalated a
// still-unresolved row directly via ModerationService.flag() — a
// moderation_queue write, which per D81 only api may do. This version
// instead publishes a `stalled: true` moderation.<type>.verdict_computed.v1
// event on a still-unresolved retry; api's own verdict-consumer treats that
// marker as the trigger to call ModerationService.flag() itself (same
// ai_triage_stalled reason, same system actor).
@Injectable()
export class ReconciliationSweepService {
  private readonly logger = new Logger(ReconciliationSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analysisService: AnalysisService,
    private readonly verdictPublisher: VerdictPublisher,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    // D66: this feature is disabled by default (no ANTHROPIC_API_KEY). A
    // pending row with no verdict is expected in that case — a human
    // reviews everything already, same as before this feature existed — not
    // the "lost/never-ran triage" gap this sweep exists to close.
    if (!isAiModerationEnabled()) return;

    for (const entityType of TRIAGEABLE_ENTITY_TYPES) {
      await this.sweepEntityType(entityType);
    }
  }

  private async sweepEntityType(entityType: TriageableEntityType): Promise<void> {
    const staleBefore = new Date(Date.now() - STALENESS_WINDOW_MS);
    const staleIds = await this.findStaleIds(entityType, staleBefore);

    for (const id of staleIds) {
      await this.reconcileOne(entityType, id);
    }
  }

  private async findStaleIds(entityType: TriageableEntityType, staleBefore: Date): Promise<string[]> {
    // Prisma.DbNull, not a plain `null` — a filter against a nullable Json
    // column's actual SQL NULL, which Prisma's JsonNullableFilter requires
    // distinguishing from a stored JSON "null" literal.
    const where = {
      status: ModerationStatus.pending,
      moderationVerdict: { equals: Prisma.DbNull },
      createdAt: { lt: staleBefore },
    };
    const rows = await (() => {
      switch (entityType) {
        case 'round_rating':
          return this.prisma.roundRating.findMany({ where, select: { id: true } });
        case 'recruiter_rating':
          return this.prisma.recruiterRating.findMany({ where, select: { id: true } });
        case 'overall_review':
          return this.prisma.overallReview.findMany({ where, select: { id: true } });
      }
    })();
    return rows.map((row) => row.id);
  }

  // Re-runs the same triage AnalysisService already exposes. A successful
  // retry publishes a normal verdict_computed event, same as the *.created
  // event path. A still-unresolved retry needs one more check before
  // escalating, same as the original api-side sweep's own hasNoVerdict()
  // did: computeVerdict() returning null covers both "still can't produce a
  // verdict" (disabled feature, repeated LLM failure — escalate) and "the
  // entity is gone" (a fast create-then-delete race — nothing left to
  // escalate, findStaleIds() already selected a row that existed a moment
  // ago). Only the former publishes a stalled escalation event.
  private async reconcileOne(entityType: TriageableEntityType, entityId: string): Promise<void> {
    const result = await this.analysisService.computeVerdict(entityType, entityId);
    if (result) {
      const { topic, event } = buildVerdictComputedEvent(entityType, entityId, result);
      await this.verdictPublisher.publish(topic, event, entityId);
      return;
    }

    if (!(await this.entityExists(entityType, entityId))) return;

    this.logger.warn(
      `Reconciliation sweep still has no verdict for ${entityType} ${entityId} — publishing a stalled escalation event`,
    );
    const { topic, event } = buildVerdictComputedEvent(entityType, entityId, null);
    await this.verdictPublisher.publish(topic, event, entityId);
  }

  private async entityExists(entityType: TriageableEntityType, entityId: string): Promise<boolean> {
    switch (entityType) {
      case 'round_rating':
        return (await this.prisma.roundRating.findUnique({ where: { id: entityId }, select: { id: true } })) !== null;
      case 'recruiter_rating':
        return (
          (await this.prisma.recruiterRating.findUnique({ where: { id: entityId }, select: { id: true } })) !== null
        );
      case 'overall_review':
        return (
          (await this.prisma.overallReview.findUnique({ where: { id: entityId }, select: { id: true } })) !== null
        );
    }
  }
}
