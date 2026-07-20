import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ModerationEntityType, ModerationFlagReason, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewSearchService } from '../search/review-search.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ModerationFlagDto } from './dto/moderation-flag.dto';

type ModerationDecision = 'approved' | 'rejected' | 'flagged';
type PrismaTransaction = Prisma.TransactionClient;

// Runs in-process within `api` for now — no Kafka consumer/`workers` process
// yet, since nothing else in the app produces to Redpanda either. Moving
// this onto a separate worker is deferred until there's actual async load to
// justify decoupling it (docs/DECISIONS.md D9), per docs/ROADMAP.md Phase 3.
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewSearchService: ReviewSearchService,
  ) {}

  // Called by the write path right after creating a rating/review — accepts
  // an optional transaction client so the moderation_queue row is created
  // atomically with the entity it references (docs/DATA_MODEL.md: this is a
  // polymorphic reference, intentionally not an FK, so nothing enforces that
  // pairing at the database level). `flagReason` is an optional pre-write
  // signal from FraudChecksService — the entity itself still starts
  // `pending` either way, see CLAUDE.md hard constraint #2.
  enqueue(
    entityType: ModerationEntityType,
    entityId: string,
    tx: PrismaTransaction = this.prisma,
    flagReason?: ModerationFlagReason,
  ) {
    return tx.moderationQueueEntry.create({ data: { entityType, entityId, flagReason } });
  }

  // Unreviewed queue entries, each enriched with its underlying entity's
  // own fields plus display context (company, role, generated labels) —
  // the moderation UI (Phase 14 issue #128) must be able to review an
  // entry without a second lookup, and pending entities are deliberately
  // unreadable through every public endpoint. Only generated labels ever
  // leave here (CLAUDE.md hard constraint #1) — never
  // internal_identifier_hash, and candidateId is omitted too since
  // moderating content doesn't require knowing who wrote it.
  async listPending() {
    const entries = await this.prisma.moderationQueueEntry.findMany({
      where: { reviewedAt: null },
      orderBy: { createdAt: 'asc' },
    });

    const idsFor = (type: ModerationEntityType) =>
      entries.filter((e) => e.entityType === type).map((e) => e.entityId);

    // One query per entity type over the whole page of entries — not one
    // per entry.
    const [roundRatings, recruiterRatings, overallReviews] = await Promise.all([
      this.prisma.roundRating.findMany({
        where: { id: { in: idsFor('round_rating') } },
        include: { round: { include: { process: { include: { company: true } } } } },
      }),
      this.prisma.recruiterRating.findMany({
        where: { id: { in: idsFor('recruiter_rating') } },
        include: {
          recruiterInteraction: {
            include: { recruiter: true, process: { include: { company: true } } },
          },
        },
      }),
      this.prisma.overallReview.findMany({
        where: { id: { in: idsFor('overall_review') } },
        include: { process: { include: { company: true } } },
      }),
    ]);

    const entityById = new Map<string, unknown>();
    for (const r of roundRatings) {
      entityById.set(r.id, {
        companyName: r.round.process.company.name,
        roleTitle: r.round.process.roleTitle,
        roundTitle: r.round.title,
        roundType: r.round.roundType,
        difficulty: r.difficulty,
        fairness: r.fairness,
        communicationFluency: r.communicationFluency,
        attentiveness: r.attentiveness,
        biasSignal: r.biasSignal,
        technicalDepth: r.technicalDepth,
        freeText: r.freeText,
      });
    }
    for (const r of recruiterRatings) {
      entityById.set(r.id, {
        companyName: r.recruiterInteraction.process.company.name,
        roleTitle: r.recruiterInteraction.process.roleTitle,
        recruiterLabel: r.recruiterInteraction.recruiter.displayLabel,
        approachability: r.approachability,
        responseTime: r.responseTime,
        timeliness: r.timeliness,
        communicationQuality: r.communicationQuality,
        freeText: r.freeText,
      });
    }
    for (const r of overallReviews) {
      entityById.set(r.id, {
        companyName: r.process.company.name,
        roleTitle: r.process.roleTitle,
        overallExperience: r.overallExperience,
        wouldRecommend: r.wouldRecommend,
        reviewText: r.reviewText,
      });
    }

    return entries.map((entry) => ({
      ...entry,
      entity: entityById.get(entry.entityId) ?? null,
    }));
  }

  approve(id: string, dto: ModerationActionDto) {
    return this.review(id, 'approved', dto);
  }

  reject(id: string, dto: ModerationActionDto) {
    return this.review(id, 'rejected', dto);
  }

  flag(id: string, dto: ModerationFlagDto) {
    return this.review(id, 'flagged', dto, dto.flagReason);
  }

  private async review(
    id: string,
    decision: ModerationDecision,
    dto: ModerationActionDto,
    flagReason?: ModerationFlagReason,
  ) {
    const entry = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });

    if (entry.reviewedAt) {
      throw new ConflictException('This item has already been reviewed.');
    }

    // Every ModerationEntityType now has a write path (round_rating since
    // Phase 3, recruiter_rating/overall_review since Phase 14) — the
    // NotImplementedException guard that used to live here is gone because
    // there's nothing left to guard against; the switch is exhaustive over
    // the enum.
    const updatedEntry = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.moderationQueueEntry.update({
        where: { id },
        data: {
          reviewedAt: new Date(),
          reviewedBy: dto.reviewedBy,
          flagReason,
        },
      });
      const statusUpdate = { where: { id: entry.entityId }, data: { status: decision } };
      switch (entry.entityType) {
        case 'round_rating':
          await tx.roundRating.update(statusUpdate);
          break;
        case 'recruiter_rating':
          await tx.recruiterRating.update(statusUpdate);
          break;
        case 'overall_review':
          await tx.overallReview.update(statusUpdate);
          break;
      }
      return updated;
    });

    // Outside the transaction, best-effort — search indexing is derived
    // (docs/DECISIONS.md D16/D17), never allowed to fail the moderation
    // decision itself, which is already committed at this point.
    // recruiter_rating isn't indexed — review search stays round_rating-only
    // (docs/ROADMAP.md Phase 14, issue #125's explicit scope note).
    if (decision === 'approved' && entry.entityType === 'round_rating') {
      await this.indexApprovedReview(entry.entityId);
    }

    return updatedEntry;
  }

  private async indexApprovedReview(roundRatingId: string) {
    try {
      const roundRating = await this.prisma.roundRating.findUniqueOrThrow({
        where: { id: roundRatingId },
        include: { round: { include: { process: true } } },
      });
      await this.reviewSearchService.indexReview({
        id: roundRating.id,
        companyId: roundRating.round.process.companyId,
        roleTitle: roundRating.round.process.roleTitle,
        roundType: roundRating.round.roundType,
        freeText: roundRating.freeText,
        createdAt: roundRating.createdAt,
        difficulty: roundRating.difficulty,
        fairness: roundRating.fairness,
        communicationFluency: roundRating.communicationFluency,
        attentiveness: roundRating.attentiveness,
        biasSignal: roundRating.biasSignal,
      });
    } catch (err) {
      this.logger.error(
        'Failed to index approved review in OpenSearch',
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
