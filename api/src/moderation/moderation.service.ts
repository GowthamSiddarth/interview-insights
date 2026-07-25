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

  // Called by an entity's update() path (GitHub issue #150): an edit
  // resets the entity to `pending` and must get a fresh queue entry, but
  // if the previous submission is still unreviewed at edit time, leaving
  // that old entry alongside a new one would let a moderator review the
  // same entity twice — superseding (deleting) any still-unreviewed
  // entry first keeps exactly one live entry per entity.
  async reenqueue(entityType: ModerationEntityType, entityId: string, tx: PrismaTransaction = this.prisma) {
    await tx.moderationQueueEntry.deleteMany({ where: { entityType, entityId, reviewedAt: null } });
    return tx.moderationQueueEntry.create({ data: { entityType, entityId } });
  }

  // Called by an entity's delete path (GitHub issue #150): the entity
  // itself is gone, so every queue entry pointing at it — reviewed or
  // not — is removed too, since moderation_queue's reference is
  // polymorphic (not an FK) and nothing else would ever clean it up.
  removeQueueEntries(entityType: ModerationEntityType, entityId: string, tx: PrismaTransaction = this.prisma) {
    return tx.moderationQueueEntry.deleteMany({ where: { entityType, entityId } });
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

    // Promise.allSettled, not Promise.all — each entity type's enrichment
    // query is isolated from the other two. A required-relation include
    // (e.g. recruiterRating -> recruiterInteraction -> process) can
    // transiently fail with "Field X is required to return data, got null
    // instead" if Prisma splits the nested include across multiple round
    // trips and a concurrent delete (e.g. GDPR erasure, issue #151, or
    // Update/Delete, issue #150) commits in between them — the FK itself
    // is real and DB-enforced (ON DELETE RESTRICT), so this is a
    // query-time race, not a durable orphaned row; see docs/DECISIONS.md
    // D37. One entity type transiently failing to enrich must never crash
    // the other two, or the whole moderation queue for every admin
    // request — its entries just fall back to `entity: null` for that
    // page, same as the pre-existing "underlying row genuinely missing"
    // case below.
    const [roundRatingsResult, recruiterRatingsResult, overallReviewsResult] = await Promise.allSettled([
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

    const roundRatings = this.settledOrEmpty(roundRatingsResult, 'round_rating');
    const recruiterRatings = this.settledOrEmpty(recruiterRatingsResult, 'recruiter_rating');
    const overallReviews = this.settledOrEmpty(overallReviewsResult, 'overall_review');

    const entityById = new Map<string, unknown>();
    for (const r of roundRatings) {
      entityById.set(r.id, {
        companyName: r.round.process.company.name,
        roleTitle: r.round.process.roleTitle,
        roundTitle: r.round.title,
        roundType: r.round.roundType,
        difficulty: r.difficulty,
        fluency: r.fluency,
        clarity: r.clarity,
        focus: r.focus,
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

  // Logs and degrades to an empty array rather than letting one entity
  // type's enrichment failure propagate — see the D37 comment on
  // listPending() for why this can transiently happen at all.
  private settledOrEmpty<T>(result: PromiseSettledResult<T[]>, entityType: ModerationEntityType): T[] {
    if (result.status === 'fulfilled') return result.value;
    this.logger.error(
      `Failed to enrich ${entityType} entries for the moderation queue — falling back to entity: null for this batch`,
      result.reason instanceof Error ? result.reason.stack : result.reason,
    );
    return [];
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
        fluency: roundRating.fluency,
        clarity: roundRating.clarity,
        focus: roundRating.focus,
      });
    } catch (err) {
      this.logger.error(
        'Failed to index approved review in OpenSearch',
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
