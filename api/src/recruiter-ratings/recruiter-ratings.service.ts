import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { CreateRecruiterRatingDto } from './dto/create-recruiter-rating.dto';

@Injectable()
export class RecruiterRatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
  ) {}

  // Same shape as RoundRatingsService.create(): status defaults to 'pending'
  // (CLAUDE.md hard constraint #2), moderation_queue row created in the same
  // transaction. No fraud-check wiring here — FraudChecksService is
  // round_rating-specific today (docs/DECISIONS.md D13); extending it to
  // other entity types is out of this issue's scope.
  create(recruiterInteractionId: string, candidateId: string, dto: CreateRecruiterRatingDto) {
    return this.prisma.$transaction(async (tx) => {
      const rating = await tx.recruiterRating.create({
        data: { ...dto, recruiterInteractionId, candidateId },
      });
      await this.moderationService.enqueue('recruiter_rating', rating.id, tx);
      return rating;
    });
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

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.recruiterRating.update({
        where: { id },
        data: { ...dto, status: 'pending' },
      });
      await this.moderationService.reenqueue('recruiter_rating', id, tx);
      return updated;
    });
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
  }
}
