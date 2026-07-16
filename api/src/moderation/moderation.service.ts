import {
  ConflictException,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import { ModerationEntityType, ModerationFlagReason, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationActionDto } from './dto/moderation-action.dto';
import { ModerationFlagDto } from './dto/moderation-flag.dto';

type ModerationDecision = 'approved' | 'rejected' | 'flagged';
type PrismaTransaction = Prisma.TransactionClient;

// Runs in-process within `api` for now — no Kafka consumer/`workers` process
// yet, since nothing else in the app produces to Redpanda either. Moving
// this onto a separate worker is deferred until there's actual async load to
// justify decoupling it (docs/DECISIONS.md D9), per docs/ROADMAP.md Phase 3.
@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

  // Called by the write path right after creating a rating/review — accepts
  // an optional transaction client so the moderation_queue row is created
  // atomically with the entity it references (docs/DATA_MODEL.md: this is a
  // polymorphic reference, intentionally not an FK, so nothing enforces that
  // pairing at the database level).
  enqueue(entityType: ModerationEntityType, entityId: string, tx: PrismaTransaction = this.prisma) {
    return tx.moderationQueueEntry.create({ data: { entityType, entityId } });
  }

  // Unreviewed queue entries — no moderator UI yet, so this is the whole
  // "inbox" for now (docs/ROADMAP.md Phase 3 issue #1 scope).
  listPending() {
    return this.prisma.moderationQueueEntry.findMany({
      where: { reviewedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  approve(id: string, dto: ModerationActionDto) {
    return this.review(id, 'approved', dto);
  }

  reject(id: string, dto: ModerationActionDto) {
    return this.review(id, 'rejected', dto);
  }

  flag(id: string, dto: ModerationFlagDto) {
    return this.review(id, 'flagged', dto, dto.flagReason);
  }

  private async review(
    id: string,
    decision: ModerationDecision,
    dto: ModerationActionDto,
    flagReason?: ModerationFlagReason,
  ) {
    const entry = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });

    if (entry.reviewedAt) {
      throw new ConflictException('This item has already been reviewed.');
    }

    if (entry.entityType !== 'round_rating') {
      // recruiter_rating / overall_review have no write path yet (Phase 2
      // only built Company -> InterviewProcess -> Round -> RoundRating), so
      // there's nothing to flip their status on. Extend this once those
      // entities exist.
      throw new NotImplementedException(
        `Moderation for entityType "${entry.entityType}" isn't implemented yet.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedEntry = await tx.moderationQueueEntry.update({
        where: { id },
        data: {
          reviewedAt: new Date(),
          reviewedBy: dto.reviewedBy,
          flagReason,
        },
      });
      await tx.roundRating.update({
        where: { id: entry.entityId },
        data: { status: decision },
      });
      return updatedEntry;
    });
  }
}
