import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoundRatingDto } from './dto/create-round-rating.dto';

@Injectable()
export class RoundRatingsService {
  constructor(private readonly prisma: PrismaService) {}

  create(roundId: string, dto: CreateRoundRatingDto) {
    // status defaults to 'pending' (schema default) — every rating starts
    // gated behind moderation, see CLAUDE.md hard constraint #2 and
    // docs/DECISIONS.md D3. Nothing here flips it to 'approved'; that's the
    // moderation worker's job (docs/ROADMAP.md Phase 3).
    return this.prisma.roundRating.create({ data: { ...dto, roundId } });
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
