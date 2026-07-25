import { Injectable } from '@nestjs/common';
import { RoundType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RoundTypeGlobalAverages {
  avgDifficulty: number;
  avgFluency: number;
  avgClarity: number;
  avgFocus: number;
  sampleSize: number;
}

export interface RecruiterGlobalAverages {
  avgReachability: number;
  avgResponsiveness: number;
  avgGuidelinesShared: number;
  sampleSize: number;
}

export interface OverallGlobalAverages {
  avgOverallExperience: number;
  pctWouldRecommend: number;
  sampleSize: number;
}

interface RoundTypeGlobalRow {
  avg_difficulty: string | null;
  avg_fluency: string | null;
  avg_clarity: string | null;
  avg_focus: string | null;
  sample_size: number | null;
}
interface RecruiterGlobalRow {
  avg_reachability: string | null;
  avg_responsiveness: string | null;
  avg_guidelines_shared: string | null;
  sample_size: number | null;
}
interface OverallGlobalRow {
  avg_overall_experience: string | null;
  pct_would_recommend: string | null;
  sample_size: number | null;
}

// Platform-wide averages to shrink a company's own average toward
// (docs/DATA_MODEL.md D4). Computed as each company's average weighted by
// its own sample_size, straight off the Phase 4 issue #7 materialized
// views — mathematically identical to averaging every raw approved rating
// directly (sum(avg_i * n_i) / sum(n_i) == true global average), without
// re-scanning the raw rating tables.
//
// Returns null when there's no data anywhere yet for the requested slice
// (platform cold-start — docs/ARCHITECTURE.md "Known scale risks"). A
// shrinkage score can't be computed without something to shrink toward.
@Injectable()
export class GlobalAveragesService {
  constructor(private readonly prisma: PrismaService) {}

  async getRoundTypeGlobalAverages(roundType: RoundType): Promise<RoundTypeGlobalAverages | null> {
    const rows = await this.prisma.$queryRaw<RoundTypeGlobalRow[]>`
      SELECT
        SUM(avg_difficulty * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_difficulty,
        SUM(avg_fluency * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_fluency,
        SUM(avg_clarity * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_clarity,
        SUM(avg_focus * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_focus,
        SUM(sample_size)::int AS sample_size
      FROM company_round_type_aggregates
      WHERE round_type = ${roundType}::"RoundType"
    `;

    const row = rows[0];
    const sampleSize = row?.sample_size ?? 0;
    if (!sampleSize) return null;

    return {
      avgDifficulty: Number(row.avg_difficulty),
      avgFluency: Number(row.avg_fluency),
      avgClarity: Number(row.avg_clarity),
      avgFocus: Number(row.avg_focus),
      sampleSize,
    };
  }

  async getRecruiterGlobalAverages(): Promise<RecruiterGlobalAverages | null> {
    const rows = await this.prisma.$queryRaw<RecruiterGlobalRow[]>`
      SELECT
        SUM(avg_reachability * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_reachability,
        SUM(avg_responsiveness * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_responsiveness,
        SUM(avg_guidelines_shared * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_guidelines_shared,
        SUM(sample_size)::int AS sample_size
      FROM company_recruiter_aggregates
    `;

    const row = rows[0];
    const sampleSize = row?.sample_size ?? 0;
    if (!sampleSize) return null;

    return {
      avgReachability: Number(row.avg_reachability),
      avgResponsiveness: Number(row.avg_responsiveness),
      avgGuidelinesShared: Number(row.avg_guidelines_shared),
      sampleSize,
    };
  }

  async getOverallGlobalAverages(): Promise<OverallGlobalAverages | null> {
    const rows = await this.prisma.$queryRaw<OverallGlobalRow[]>`
      SELECT
        SUM(avg_overall_experience * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_overall_experience,
        SUM(pct_would_recommend * sample_size) / NULLIF(SUM(sample_size), 0) AS pct_would_recommend,
        SUM(sample_size)::int AS sample_size
      FROM company_overall_aggregates
    `;

    const row = rows[0];
    const sampleSize = row?.sample_size ?? 0;
    if (!sampleSize) return null;

    return {
      avgOverallExperience: Number(row.avg_overall_experience),
      pctWouldRecommend: Number(row.pct_would_recommend),
      sampleSize,
    };
  }
}
