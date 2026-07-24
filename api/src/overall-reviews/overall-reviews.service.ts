import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { CreateOverallReviewDto } from './dto/create-overall-review.dto';

@Injectable()
export class OverallReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
  ) {}

  // Same shape as RoundRatingsService/RecruiterRatingsService.create():
  // status defaults to 'pending' (CLAUDE.md hard constraint #2),
  // moderation_queue row created in the same transaction. The one-per-process
  // rule is the schema's UNIQUE(process_id) (docs/DATA_MODEL.md) — a second
  // submission surfaces as a 409 via PrismaExceptionFilter, not app logic.
  // No fraud-check wiring, same scope note as recruiter ratings (D13's
  // FraudChecksService is round_rating-specific today).
  create(processId: string, candidateId: string, dto: CreateOverallReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.overallReview.create({
        data: { ...dto, processId, candidateId },
      });
      await this.moderationService.enqueue('overall_review', review.id, tx);
      return review;
    });
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
}
