import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';
import { CreateRoundRatingDto } from './dto/create-round-rating.dto';

@Injectable()
export class RoundRatingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ModerationService,
    private readonly fraudChecksService: FraudChecksService,
  ) {}

  create(roundId: string, dto: CreateRoundRatingDto) {
    // status defaults to 'pending' (schema default) — every rating starts
    // gated behind moderation, see CLAUDE.md hard constraint #2 and
    // docs/DECISIONS.md D3. The moderation_queue row is created in the same
    // transaction so a rating can never exist without one (docs/DATA_MODEL.md
    // notes this pairing isn't enforced by an FK).
    return this.prisma.$transaction(async (tx) => {
      // Runs against pre-existing rows only (before this one is inserted),
      // so it never flags a rating as a duplicate of itself.
      const flagReason = await this.fraudChecksService.detectFlagReason(
        dto.candidateId,
        dto.freeText,
        tx,
      );
      const rating = await tx.roundRating.create({ data: { ...dto, roundId } });
      await this.moderationService.enqueue('round_rating', rating.id, tx, flagReason);
      return rating;
    });
  }

  // Public read — only ever returns moderation-approved ratings. Will be
  // empty until the Phase 3 moderation worker exists to approve rows.
  findApprovedForRound(roundId: string) {
    return this.prisma.roundRating.findMany({
      where: { roundId, status: 'approved' },
      orderBy: { createdAt: 'desc' },
    });
  }
}
