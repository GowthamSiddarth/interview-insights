import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';
import { RecruitersService } from '../recruiters/recruiters.service';
import { RoundTypeFieldOptionsService } from '../round-type-registry/round-type-field-options.service';
import { AiModerationService } from '../ai-moderation/ai-moderation.service';
import { CreateBulkProcessDto } from './dto/create-bulk-process.dto';

// GitHub issue #251 (Phase 25) — the backend counterpart Phase 26's
// client-side draft wizard needs before it can submit anything for real.
// Existing per-entity endpoints stay unchanged; this is a new path, not a
// replacement. Everything happens in one $transaction: any failure (a
// validation error, a constraint violation) rolls back the entire
// submission with zero rows created — no partial success. Round ratings
// and recruiter interactions/ratings are created sequentially (not in
// parallel): FraudChecksService's rate limit (GitHub issue #317, D52)
// now counts `InterviewProcess` rows, not individual entities, so one
// bulk submission's own several round ratings never trip it on each
// other the way the old entity-count version could — but duplicate-text
// detection still scans rows already inserted earlier in this same
// transaction, so sequential creation is what lets two identical
// freeText values within one submission correctly flag the second as a
// duplicate of the first.
@Injectable()
export class BulkProcessSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
    private readonly fraudChecksService: FraudChecksService,
    private readonly recruitersService: RecruitersService,
    private readonly roundTypeFieldOptionsService: RoundTypeFieldOptionsService,
    private readonly aiModerationService: AiModerationService,
  ) {}

  async create(companyId: string, candidateId: string, dto: CreateBulkProcessDto) {
    const { rounds, recruiterInteractions, overallReview, ...processFields } = dto;

    // Every rateable entity created below gets indexed for moderator
    // search (GitHub issue #370) once this whole transaction commits —
    // never from inside it, same D16/D17 reasoning every other
    // post-commit indexing call in this app follows.
    const roundRatingIds: string[] = [];
    const recruiterRatingIds: string[] = [];
    let overallReviewId: string | undefined;

    const process = await this.prisma.$transaction(async (tx) => {
      // GitHub issue #369 (Phase 35) — same guard as the single-process
      // endpoint: a pending/rejected company doesn't publicly exist yet.
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { status: true },
      });
      if (!company || company.status !== 'approved') {
        throw new NotFoundException('Company not found.');
      }

      const process = await tx.interviewProcess.create({
        data: { ...processFields, companyId, candidateId },
      });

      for (const roundDto of rounds ?? []) {
        const { rating, ...roundFields } = roundDto;
        await this.roundTypeFieldOptionsService.validateTypeMetadata(
          roundFields.roundType,
          roundFields.typeMetadata,
        );
        const round = await tx.round.create({
          data: {
            ...roundFields,
            processId: process.id,
            typeMetadata: roundFields.typeMetadata as Prisma.InputJsonValue | undefined,
          },
        });

        if (rating) {
          const flagReason = await this.fraudChecksService.detectFlagReason(
            candidateId,
            'round_rating',
            rating.freeText,
            tx,
          );
          const roundRating = await tx.roundRating.create({
            data: { ...rating, roundId: round.id, candidateId },
          });
          await this.moderationService.enqueue('round_rating', roundRating.id, tx, flagReason);
          roundRatingIds.push(roundRating.id);
        }
      }

      for (const interactionDto of recruiterInteractions ?? []) {
        const { recruiterIdentifier, rating } = interactionDto;
        const recruiter = await this.recruitersService.findOrCreate(
          companyId,
          recruiterIdentifier,
          tx,
        );
        const interaction = await tx.recruiterInteraction.create({
          data: { processId: process.id, recruiterId: recruiter.id },
        });

        if (rating) {
          const flagReason = await this.fraudChecksService.detectFlagReason(
            candidateId,
            'recruiter_rating',
            rating.freeText,
            tx,
          );
          const recruiterRating = await tx.recruiterRating.create({
            data: { ...rating, recruiterInteractionId: interaction.id, candidateId },
          });
          await this.moderationService.enqueue('recruiter_rating', recruiterRating.id, tx, flagReason);
          recruiterRatingIds.push(recruiterRating.id);
        }
      }

      if (overallReview) {
        const flagReason = await this.fraudChecksService.detectFlagReason(
          candidateId,
          'overall_review',
          overallReview.reviewText,
          tx,
        );
        const review = await tx.overallReview.create({
          data: { ...overallReview, processId: process.id, candidateId },
        });
        await this.moderationService.enqueue('overall_review', review.id, tx, flagReason);
        overallReviewId = review.id;
      }

      return process;
    });

    for (const id of roundRatingIds) {
      await this.moderationService.indexForSearch('round_rating', id);
      await this.aiModerationService.computeAndStoreVerdict('round_rating', id);
    }
    for (const id of recruiterRatingIds) {
      await this.moderationService.indexForSearch('recruiter_rating', id);
      await this.aiModerationService.computeAndStoreVerdict('recruiter_rating', id);
    }
    if (overallReviewId) {
      await this.moderationService.indexForSearch('overall_review', overallReviewId);
      await this.aiModerationService.computeAndStoreVerdict('overall_review', overallReviewId);
    }

    return process;
  }
}
