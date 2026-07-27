import { Injectable } from '@nestjs/common';
import { ModerationEntityType, ModerationFlagReason, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PrismaTransaction = Prisma.TransactionClient;

// Placeholders, not tuned against real data yet — see docs/DECISIONS.md D3
// framing (basic checks now, revisit once there's real volume), same spirit
// as the shrinkage-formula `k` constant in docs/DATA_MODEL.md.
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX_SUBMISSIONS = 3;

// Starting placeholder, not tuned against real data yet (GitHub issue #162)
// — same "revisit once there's real volume" spirit as
// RATE_LIMIT_MAX_SUBMISSIONS and the shrinkage formula's `k`.
const DUPLICATE_SIMILARITY_THRESHOLD = 0.55;

function normalizeFreeText(freeText: string): string {
  return freeText.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface SimilarityTableConfig {
  table: string;
  column: string;
}

const SIMILARITY_TABLE_BY_ENTITY_TYPE: Record<
  Exclude<ModerationEntityType, 'company'>,
  SimilarityTableConfig
> = {
  round_rating: { table: 'round_ratings', column: 'free_text' },
  recruiter_rating: { table: 'recruiter_ratings', column: 'free_text' },
  overall_review: { table: 'overall_reviews', column: 'review_text' },
};

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

  // GitHub issue #162 / docs/DECISIONS.md D64: pg_trgm trigram similarity,
  // computed in Postgres (never an app-code full-table scan-and-compare —
  // the D13 limitation this replaces). An exact match after normalizing
  // whitespace/case is just the similarity-1.0 case, so this single check
  // now covers both what the original exact-match implementation did and
  // genuine near-duplicates (typos, light rewording). Scoped per entity
  // type/field exactly as GitHub issue #317 already established — a
  // recruiter rating's freeText is only compared against other recruiter
  // ratings' freeText, never cross-type.
  async checkDuplicateFreeText(
    entityType: ModerationEntityType,
    freeText: string | null | undefined,
    tx: PrismaTransaction = this.prisma,
  ): Promise<boolean> {
    if (!freeText?.trim()) return false;
    if (entityType === 'company') return false;

    const normalized = normalizeFreeText(freeText);
    const { table, column } = SIMILARITY_TABLE_BY_ENTITY_TYPE[entityType];
    return this.hasSimilarExistingText(tx, table, column, normalized);
  }

  private async hasSimilarExistingText(
    tx: PrismaTransaction,
    table: string,
    column: string,
    normalizedFreeText: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ found: boolean }[]>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM ${Prisma.raw(`"${table}"`)}
        WHERE ${Prisma.raw(`"${column}"`)} IS NOT NULL
          AND similarity(lower(${Prisma.raw(`"${column}"`)}), ${normalizedFreeText}) > ${DUPLICATE_SIMILARITY_THRESHOLD}
      ) AS "found"
    `);
    return rows[0]?.found ?? false;
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
