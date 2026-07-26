import { Injectable } from '@nestjs/common';
import { ModerationEntityType, ModerationFlagReason, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PrismaTransaction = Prisma.TransactionClient;

// Placeholders, not tuned against real data yet — see docs/DECISIONS.md D3
// framing (basic checks now, revisit once there's real volume), same spirit
// as the shrinkage-formula `k` constant in docs/DATA_MODEL.md.
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX_SUBMISSIONS = 3;

function normalizeFreeText(freeText: string): string {
  return freeText.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Pre-write signal only — never blocks a write outright. A write that trips
// a check still gets created as `pending` like every other rating (CLAUDE.md
// hard constraint #2 says "every review/rating write" starts pending, no
// exception for suspicious ones); this only attaches a `flagReason` to its
// moderation_queue entry so a human reviewer sees why it's suspicious.
@Injectable()
export class FraudChecksService {
  constructor(private readonly prisma: PrismaService) {}

  // GitHub issue #317 / docs/DECISIONS.md D52: counts `InterviewProcess`
  // creations (submissions), not individual round/recruiter/overall rows.
  // The previous entity-count version could trip on a single legitimate
  // multi-round submission, since Phase 25/26 explicitly support several
  // round ratings per submission — one real interview loop with 5 rounds
  // is 1 event under this model, not 5. Applies identically regardless of
  // which entity type is being created within a submission (round rating,
  // recruiter rating, or overall review), since the signal being measured
  // — "is this candidate creating an excessive number of submissions" —
  // doesn't depend on entity type at all.
  async checkRateLimit(candidateId: string, tx: PrismaTransaction = this.prisma): Promise<boolean> {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const count = await tx.interviewProcess.count({
      where: { candidateId, createdAt: { gte: windowStart } },
    });
    return count >= RATE_LIMIT_MAX_SUBMISSIONS;
  }

  async checkDuplicateFreeText(
    entityType: ModerationEntityType,
    freeText: string | null | undefined,
    tx: PrismaTransaction = this.prisma,
  ): Promise<boolean> {
    if (!freeText?.trim()) return false;
    const normalized = normalizeFreeText(freeText);

    // Full-table scan-and-compare in application code — fine at today's
    // data volume, not something that scales. Revisit with a Postgres
    // trigram index or the OpenSearch layer (docs/ROADMAP.md Phase 5) once
    // real volume makes this slow. Also exact-match only (after
    // normalizing whitespace/case) — genuinely fuzzy near-duplicate
    // detection is a further-out enhancement, not this issue's scope.
    // Scoped per entity type/field (GitHub issue #317): a recruiter
    // rating's freeText is only compared against other recruiter
    // ratings' freeText, never cross-type.
    const existing = await this.fetchExistingFreeText(entityType, tx);
    return existing.some((text) => text !== null && normalizeFreeText(text) === normalized);
  }

  private async fetchExistingFreeText(
    entityType: ModerationEntityType,
    tx: PrismaTransaction,
  ): Promise<(string | null)[]> {
    switch (entityType) {
      case 'round_rating': {
        const rows = await tx.roundRating.findMany({
          where: { freeText: { not: null } },
          select: { freeText: true },
        });
        return rows.map((r) => r.freeText);
      }
      case 'recruiter_rating': {
        const rows = await tx.recruiterRating.findMany({
          where: { freeText: { not: null } },
          select: { freeText: true },
        });
        return rows.map((r) => r.freeText);
      }
      case 'overall_review': {
        const rows = await tx.overallReview.findMany({
          where: { reviewText: { not: null } },
          select: { reviewText: true },
        });
        return rows.map((r) => r.reviewText);
      }
      // GitHub issue #369 (Phase 35) — company creation requests never go
      // through fraud checks at all (out of scope: a company isn't a
      // review, and its create() path never calls detectFlagReason()),
      // but the switch must stay exhaustive over ModerationEntityType.
      case 'company':
        return [];
    }
  }

  // Only one flagReason fits per moderation_queue row, so if multiple
  // checks trip, rate_limit wins — arbitrary but deterministic priority.
  async detectFlagReason(
    candidateId: string,
    entityType: ModerationEntityType,
    freeText: string | null | undefined,
    tx: PrismaTransaction = this.prisma,
  ): Promise<ModerationFlagReason | undefined> {
    if (await this.checkRateLimit(candidateId, tx)) return 'rate_limit';
    if (await this.checkDuplicateFreeText(entityType, freeText, tx)) return 'duplicate';
    return undefined;
  }
}
