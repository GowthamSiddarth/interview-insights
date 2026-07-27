import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';
import { AiModerationService } from '../ai-moderation/ai-moderation.service';
import { CreateRecruiterRatingDto } from './dto/create-recruiter-rating.dto';

@Injectable()
export class RecruiterRatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
    private readonly fraudChecksService: FraudChecksService,
    private readonly aiModerationService: AiModerationService,
  ) {}

  // Same shape as RoundRatingsService.create(): status defaults to 'pending'
  // (CLAUDE.md hard constraint #2), moderation_queue row created in the same
  // transaction. Fraud-check wiring added in GitHub issue #317 (D52) —
  // FraudChecksService's rate limit now counts submissions, not entities,
  // so it applies identically here as it does for round ratings.
  async create(recruiterInteractionId: string, candidateId: string, dto: CreateRecruiterRatingDto) {
    const rating = await this.prisma.$transaction(async (tx) => {
      // Runs against pre-existing rows only (before this one is inserted),
      // so it never flags a rating as a duplicate of itself.
      const flagReason = await this.fraudChecksService.detectFlagReason(
        candidateId,
        'recruiter_rating',
        dto.freeText,
        tx,
      );
      const rating = await tx.recruiterRating.create({
        data: { ...dto, recruiterInteractionId, candidateId },
      });
      await this.moderationService.enqueue('recruiter_rating', rating.id, tx, flagReason);
      return rating;
    });
    // GitHub issue #370 — after commit, best-effort, same D16/D17 shape.
    await this.moderationService.indexForSearch('recruiter_rating', rating.id);
    // GitHub issue #163 (Phase 19) — advisory LLM triage, best-effort.
    await this.aiModerationService.computeAndStoreVerdict('recruiter_rating', rating.id);
    return rating;
  }

  // Public read — only ever returns moderation-approved ratings.
  findApprovedForInteraction(recruiterInteractionId: string) {
    return this.prisma.recruiterRating.findMany({
      where: { recruiterInteractionId, status: 'approved' },
      orderBy: { createdAt: 'desc' },
    });
  }

  // GitHub issue #150 — same shape as RoundRatingsService.update(): reset
  // to pending, re-enqueue (superseding any still-unreviewed entry).
  async update(
    recruiterInteractionId: string,
    id: string,
    candidateId: string,
    dto: CreateRecruiterRatingDto,
  ) {
    const rating = await this.prisma.recruiterRating.findFirstOrThrow({
      where: { id, recruiterInteractionId },
    });
    if (rating.candidateId !== candidateId) {
      throw new ForbiddenException('You can only edit your own rating.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.recruiterRating.update({
        where: { id },
        data: { ...dto, status: 'pending' },
      });
      await this.moderationService.reenqueue('recruiter_rating', id, tx);
      return updated;
    });
    await this.moderationService.indexForSearch('recruiter_rating', id);
    await this.aiModerationService.computeAndStoreVerdict('recruiter_rating', id);
    return updated;
  }

  // GitHub issue #150 — same shape as RoundRatingsService.remove(), minus
  // the search-index step (recruiter_rating is never indexed, D17 scope
  // note).
  async remove(recruiterInteractionId: string, id: string, candidateId: string): Promise<void> {
    const rating = await this.prisma.recruiterRating.findFirstOrThrow({
      where: { id, recruiterInteractionId },
    });
    if (rating.candidateId !== candidateId) {
      throw new ForbiddenException('You can only delete your own rating.');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.moderationService.removeQueueEntries('recruiter_rating', id, tx);
      await tx.recruiterRating.delete({ where: { id } });
    });
    await this.moderationService.removeFromSearchIndex('recruiter_rating', id);
  }
}
