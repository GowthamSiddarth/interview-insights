import { Injectable } from '@nestjs/common';
import { ModerationFlagReason, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PrismaTransaction = Prisma.TransactionClient;

// Placeholders, not tuned against real data yet — see docs/DECISIONS.md D3
// framing (basic checks now, revisit once there's real volume), same spirit
// as the shrinkage-formula `k` constant in docs/DATA_MODEL.md.
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX_RATINGS = 3;

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

  async checkRateLimit(candidateId: string, tx: PrismaTransaction = this.prisma): Promise<boolean> {
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const count = await tx.roundRating.count({
      where: { candidateId, createdAt: { gte: windowStart } },
    });
    return count >= RATE_LIMIT_MAX_RATINGS;
  }

  async checkDuplicateFreeText(
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
    const existing = await tx.roundRating.findMany({
      where: { freeText: { not: null } },
      select: { freeText: true },
    });
    return existing.some((r) => r.freeText !== null && normalizeFreeText(r.freeText) === normalized);
  }

  // Only one flagReason fits per moderation_queue row, so if multiple
  // checks trip, rate_limit wins — arbitrary but deterministic priority.
  async detectFlagReason(
    candidateId: string,
    freeText: string | null | undefined,
    tx: PrismaTransaction = this.prisma,
  ): Promise<ModerationFlagReason | undefined> {
    if (await this.checkRateLimit(candidateId, tx)) return 'rate_limit';
    if (await this.checkDuplicateFreeText(freeText, tx)) return 'duplicate';
    return undefined;
  }
}
