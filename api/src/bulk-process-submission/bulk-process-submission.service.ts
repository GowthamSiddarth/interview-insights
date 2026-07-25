import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';
import { RecruitersService } from '../recruiters/recruiters.service';
import { RoundTypeFieldOptionsService } from '../round-type-registry/round-type-field-options.service';
import { CreateBulkProcessDto } from './dto/create-bulk-process.dto';

// GitHub issue #251 (Phase 25) — the backend counterpart Phase 26's
// client-side draft wizard needs before it can submit anything for real.
// Existing per-entity endpoints stay unchanged; this is a new path, not a
// replacement. Everything happens in one $transaction: any failure (a
// validation error, a constraint violation) rolls back the entire
// submission with zero rows created — no partial success. Round ratings
// and recruiter interactions/ratings are created sequentially (not in
// parallel), not just incidentally: FraudChecksService's rolling-window
// rate-limit check counts rows already inserted earlier in this same
// transaction, so sequential creation is what makes "a bulk submission of
// several round ratings in one call is evaluated against the existing
// limit correctly" (the issue's own acceptance criterion) hold at all.
@Injectable()
export class BulkProcessSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
    private readonly fraudChecksService: FraudChecksService,
    private readonly recruitersService: RecruitersService,
    private readonly roundTypeFieldOptionsService: RoundTypeFieldOptionsService,
  ) {}

  create(companyId: string, candidateId: string, dto: CreateBulkProcessDto) {
    const { rounds, recruiterInteractions, overallReview, ...processFields } = dto;

    return this.prisma.$transaction(async (tx) => {
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
            rating.freeText,
            tx,
          );
          const roundRating = await tx.roundRating.create({
            data: { ...rating, roundId: round.id, candidateId },
          });
          await this.moderationService.enqueue('round_rating', roundRating.id, tx, flagReason);
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
          const recruiterRating = await tx.recruiterRating.create({
            data: { ...rating, recruiterInteractionId: interaction.id, candidateId },
          });
          await this.moderationService.enqueue('recruiter_rating', recruiterRating.id, tx);
        }
      }

      if (overallReview) {
        const review = await tx.overallReview.create({
          data: { ...overallReview, processId: process.id, candidateId },
        });
        await this.moderationService.enqueue('overall_review', review.id, tx);
      }

      return process;
    });
  }
}
