import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ModerationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { AiModerationService, TriageableEntityType } from './ai-moderation.service';
import { isAiModerationEnabled } from './ai-moderation.env';

// GitHub issue #442 (Phase 39, D71) — 24h staleness window, same value
// D71's own rationale gives: long enough to never fight the LLM call's
// normal (sub-second to low-seconds) latency or retry backoff.
const STALENESS_WINDOW_MS = 24 * 60 * 60 * 1000;

// Distinct from AUTO_APPROVAL_SYSTEM_ACTOR (ai-moderation.service.ts) —
// this actor only ever flags, never approves, and the audit trail should
// tell the two apart.
export const RECONCILIATION_SWEEP_SYSTEM_ACTOR = 'system:ai-reconciliation-sweep';

const TRIAGEABLE_ENTITY_TYPES: readonly TriageableEntityType[] = [
  'round_rating',
  'recruiter_rating',
  'overall_review',
];

// GitHub issue #442 (Phase 39, D71) — closes the "lost/never-ran triage"
// gap without a transactional outbox (D9-style "don't build infrastructure
// ahead of a demonstrated need"): a scheduled sweep re-runs
// AiModerationService.computeAndStoreVerdict() for any pending row whose
// moderationVerdict is still null past the 24h staleness window, and
// escalates to a human-visible flag (ModerationService.flag(), same path a
// moderator's own flag click uses) if that retry fails again. No
// transactional outbox — escalate to one only if this sweep's staleness
// window turns out to be a real problem in practice.
@Injectable()
export class ReconciliationSweepService {
  private readonly logger = new Logger(ReconciliationSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiModerationService: AiModerationService,
    private readonly moderationService: ModerationService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    // D66: this feature is disabled by default (no ANTHROPIC_API_KEY). A
    // pending row with no verdict is expected in that case — a human
    // reviews everything already, same as before this feature existed —
    // not the "lost/never-ran triage" gap this sweep exists to close.
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
    // Prisma.DbNull, not a plain `null` — this is a filter against a
    // nullable Json column's actual SQL NULL, which Prisma's JsonNullableFilter
    // requires distinguishing from a stored JSON "null" literal.
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

  // Re-runs the same triage AiModerationService already exposes, then
  // checks whether that retry actually resolved the row (a verdict was
  // stored, even if not auto-approval eligible) before deciding whether to
  // escalate. computeAndStoreVerdict() never throws — any failure is
  // already caught and logged inside it — so "did it work" has to be
  // observed from the row's own state afterward, not from this call.
  private async reconcileOne(entityType: TriageableEntityType, entityId: string): Promise<void> {
    await this.aiModerationService.computeAndStoreVerdict(entityType, entityId);

    const stillUnresolved = await this.hasNoVerdict(entityType, entityId);
    // null: the entity is gone (fast create-then-delete race) — nothing
    // left to escalate. false: the retry produced a verdict this time.
    if (stillUnresolved !== true) return;

    await this.escalate(entityType, entityId);
  }

  private async hasNoVerdict(entityType: TriageableEntityType, entityId: string): Promise<boolean | null> {
    switch (entityType) {
      case 'round_rating': {
        const row = await this.prisma.roundRating.findUnique({
          where: { id: entityId },
          select: { moderationVerdict: true },
        });
        return row ? row.moderationVerdict === null : null;
      }
      case 'recruiter_rating': {
        const row = await this.prisma.recruiterRating.findUnique({
          where: { id: entityId },
          select: { moderationVerdict: true },
        });
        return row ? row.moderationVerdict === null : null;
      }
      case 'overall_review': {
        const row = await this.prisma.overallReview.findUnique({
          where: { id: entityId },
          select: { moderationVerdict: true },
        });
        return row ? row.moderationVerdict === null : null;
      }
    }
  }

  // Routes through the same ModerationService.flag() a human moderator's
  // own flag click already calls — never a new, parallel escalation path
  // — attributed to a distinct system actor and a dedicated flag reason
  // (ai_triage_stalled) so a moderator reading the queue can tell this
  // apart from every content-shaped flag reason above it.
  private async escalate(entityType: TriageableEntityType, entityId: string): Promise<void> {
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

    try {
      await this.moderationService.flag(queueEntry.id, {
        reviewedBy: RECONCILIATION_SWEEP_SYSTEM_ACTOR,
        flagReason: 'ai_triage_stalled',
      });
    } catch (err) {
      this.logger.error(
        `Failed to escalate stalled ${entityType} ${entityId} to a human-visible flag`,
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
