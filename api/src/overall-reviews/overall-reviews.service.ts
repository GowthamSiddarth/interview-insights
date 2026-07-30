import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';
import { AiModerationService } from '../ai-moderation/ai-moderation.service';
import { CreateOverallReviewDto } from './dto/create-overall-review.dto';

@Injectable()
export class OverallReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
    private readonly fraudChecksService: FraudChecksService,
    private readonly aiModerationService: AiModerationService,
  ) {}

  // Same shape as RoundRatingsService/RecruiterRatingsService.create():
  // status defaults to 'pending' (CLAUDE.md hard constraint #2),
  // moderation_queue row created in the same transaction. The one-per-process
  // rule is the schema's UNIQUE(process_id) (docs/DATA_MODEL.md) — a second
  // submission surfaces as a 409 via PrismaExceptionFilter, not app logic.
  // Fraud-check wiring added in GitHub issue #317 (D52) — see
  // RecruiterRatingsService.create()'s comment for why this now applies
  // identically to round ratings.
  async create(processId: string, candidateId: string, dto: CreateOverallReviewDto) {
    const review = await this.prisma.$transaction(async (tx) => {
      const flagReason = await this.fraudChecksService.detectFlagReason(
        candidateId,
        'overall_review',
        dto.reviewText,
        tx,
      );
      const review = await tx.overallReview.create({
        data: { ...dto, processId, candidateId },
      });
      await this.moderationService.enqueue('overall_review', review.id, tx, flagReason);
      return review;
    });
    // GitHub issue #370 — after commit, best-effort, same D16/D17 shape.
    await this.moderationService.indexForSearch('overall_review', review.id);
    // GitHub issue #163 (Phase 19) — advisory LLM triage, best-effort.
    await this.aiModerationService.computeAndStoreVerdict('overall_review', review.id);
    // GitHub issue #332 (Phase 30, D53) — domain event, best-effort.
    await this.moderationService.publishCreatedEvent('overall_review', review.id);
    return review;
  }

  // Public read — the process's approved overall review, or null (empty
  // response) while it's still pending/rejected or was never submitted.
  // Singular by construction (UNIQUE(process_id)), hence findFirst not
  // findMany.
  findApprovedForProcess(processId: string) {
    return this.prisma.overallReview.findFirst({
      where: { processId, status: 'approved' },
    });
  }

  // GitHub issue #150 — singular resource (UNIQUE(process_id)), so
  // there's no separate review id to scope by; processId alone
  // identifies it. Same reset-to-pending + re-enqueue shape as the other
  // two entity types.
  async update(processId: string, candidateId: string, dto: CreateOverallReviewDto) {
    const review = await this.prisma.overallReview.findFirstOrThrow({ where: { processId } });
    if (review.candidateId !== candidateId) {
      throw new ForbiddenException('You can only edit your own review.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.overallReview.update({
        where: { processId },
        data: { ...dto, status: 'pending' },
      });
      await this.moderationService.reenqueue('overall_review', review.id, tx);
      return updated;
    });
    await this.moderationService.indexForSearch('overall_review', review.id);
    await this.aiModerationService.computeAndStoreVerdict('overall_review', review.id);
    return updated;
  }

  async remove(processId: string, candidateId: string): Promise<void> {
    const review = await this.prisma.overallReview.findFirstOrThrow({ where: { processId } });
    if (review.candidateId !== candidateId) {
      throw new ForbiddenException('You can only delete your own review.');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.moderationService.removeQueueEntries('overall_review', review.id, tx);
      await tx.overallReview.delete({ where: { processId } });
    });
    await this.moderationService.removeFromSearchIndex('overall_review', review.id);
  }
}
