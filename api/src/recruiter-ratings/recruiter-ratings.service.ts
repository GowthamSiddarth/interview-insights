import { Injectable } from '@nestjs/common';
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
  create(recruiterInteractionId: string, dto: CreateRecruiterRatingDto) {
    return this.prisma.$transaction(async (tx) => {
      const rating = await tx.recruiterRating.create({
        data: { ...dto, recruiterInteractionId },
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
}
