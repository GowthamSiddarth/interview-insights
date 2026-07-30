import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';
import { ReviewSearchService } from '../search/review-search.service';
import { AiModerationService } from '../ai-moderation/ai-moderation.service';
import { CreateRoundRatingDto } from './dto/create-round-rating.dto';

@Injectable()
export class RoundRatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
    private readonly fraudChecksService: FraudChecksService,
    private readonly reviewSearchService: ReviewSearchService,
    private readonly aiModerationService: AiModerationService,
  ) {}

  async create(roundId: string, candidateId: string, dto: CreateRoundRatingDto) {
    // status defaults to 'pending' (schema default) — every rating starts
    // gated behind moderation, see CLAUDE.md hard constraint #2 and
    // docs/DECISIONS.md D3. The moderation_queue row is created in the same
    // transaction so a rating can never exist without one (docs/DATA_MODEL.md
    // notes this pairing isn't enforced by an FK).
    const rating = await this.prisma.$transaction(async (tx) => {
      // Runs against pre-existing rows only (before this one is inserted),
      // so it never flags a rating as a duplicate of itself.
      const flagReason = await this.fraudChecksService.detectFlagReason(
        candidateId,
        'round_rating',
        dto.freeText,
        tx,
      );
      const rating = await tx.roundRating.create({ data: { ...dto, roundId, candidateId } });
      await this.moderationService.enqueue('round_rating', rating.id, tx, flagReason);
      return rating;
    });
    // GitHub issue #370 — after commit, best-effort, same D16/D17 shape.
    await this.moderationService.indexForSearch('round_rating', rating.id);
    // GitHub issue #163 (Phase 19) — advisory LLM triage, after commit,
    // fully best-effort (never throws, see AiModerationService).
    await this.aiModerationService.computeAndStoreVerdict('round_rating', rating.id);
    // GitHub issue #332 (Phase 30, D53) — domain event, after commit,
    // fully best-effort (never throws, see DomainEventPublisher).
    await this.moderationService.publishCreatedEvent('round_rating', rating.id);
    return rating;
  }

  // Public read — only ever returns moderation-approved ratings. Will be
  // empty until the Phase 3 moderation worker exists to approve rows.
  findApprovedForRound(roundId: string) {
    return this.prisma.roundRating.findMany({
      where: { roundId, status: 'approved' },
      orderBy: { createdAt: 'desc' },
    });
  }

  // GitHub issue #150: an edit never modifies public content in place —
  // it resets status to `pending` and gets a fresh moderation_queue
  // entry (superseding any still-unreviewed one), same as a brand-new
  // submission going back through the full moderation gate.
  // findFirstOrThrow scopes to roundId too (not just id), so an id that
  // exists but under a different round 404s rather than leaking whether
  // it exists elsewhere; ownership (candidateId) is checked separately
  // as a 403, not folded into the same query, so an owner mismatch is
  // distinguishable from a genuinely missing rating.
  async update(roundId: string, id: string, candidateId: string, dto: CreateRoundRatingDto) {
    const rating = await this.prisma.roundRating.findFirstOrThrow({ where: { id, roundId } });
    if (rating.candidateId !== candidateId) {
      throw new ForbiddenException('You can only edit your own rating.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.roundRating.update({
        where: { id },
        data: { ...dto, status: 'pending' },
      });
      await this.moderationService.reenqueue('round_rating', id, tx);
      return updated;
    });
    await this.moderationService.indexForSearch('round_rating', id);
    // Re-triage the edited content — a stale verdict against the pre-edit
    // text would be misleading to a moderator (GitHub issue #163).
    await this.aiModerationService.computeAndStoreVerdict('round_rating', id);
    return updated;
  }

  // A candidate may delete their own rating at any status. Also removes
  // its moderation_queue entry (which would otherwise be orphaned — no
  // FK ties them together, docs/DATA_MODEL.md) and, if it had been
  // approved, best-effort removes it from the review search index —
  // outside the transaction, after the DB delete has committed, same
  // D16/D17 pattern as indexing an approval.
  async remove(roundId: string, id: string, candidateId: string): Promise<void> {
    const rating = await this.prisma.roundRating.findFirstOrThrow({ where: { id, roundId } });
    if (rating.candidateId !== candidateId) {
      throw new ForbiddenException('You can only delete your own rating.');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.moderationService.removeQueueEntries('round_rating', id, tx);
      await tx.roundRating.delete({ where: { id } });
    });

    await this.moderationService.removeFromSearchIndex('round_rating', id);
    if (rating.status === 'approved') {
      await this.reviewSearchService.removeReview(id);
    }
  }
}
