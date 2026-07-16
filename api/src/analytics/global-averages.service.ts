import { Injectable } from '@nestjs/common';
import { RoundType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RoundTypeGlobalAverages {
  avgDifficulty: number;
  avgFairness: number;
  avgCommunicationFluency: number;
  avgAttentiveness: number;
  avgBiasSignal: number;
  sampleSize: number;
}

export interface RecruiterGlobalAverages {
  avgApproachability: number;
  avgResponseTime: number;
  avgTimeliness: number;
  avgCommunicationQuality: number;
  sampleSize: number;
}

export interface OverallGlobalAverages {
  avgOverallExperience: number;
  pctWouldRecommend: number;
  sampleSize: number;
}

interface RoundTypeGlobalRow {
  avg_difficulty: string | null;
  avg_fairness: string | null;
  avg_communication_fluency: string | null;
  avg_attentiveness: string | null;
  avg_bias_signal: string | null;
  sample_size: number | null;
}
interface RecruiterGlobalRow {
  avg_approachability: string | null;
  avg_response_time: string | null;
  avg_timeliness: string | null;
  avg_communication_quality: string | null;
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
        SUM(avg_fairness * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_fairness,
        SUM(avg_communication_fluency * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_communication_fluency,
        SUM(avg_attentiveness * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_attentiveness,
        SUM(avg_bias_signal * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_bias_signal,
        SUM(sample_size)::int AS sample_size
      FROM company_round_type_aggregates
      WHERE round_type = ${roundType}::"RoundType"
    `;

    const row = rows[0];
    const sampleSize = row?.sample_size ?? 0;
    if (!sampleSize) return null;

    return {
      avgDifficulty: Number(row.avg_difficulty),
      avgFairness: Number(row.avg_fairness),
      avgCommunicationFluency: Number(row.avg_communication_fluency),
      avgAttentiveness: Number(row.avg_attentiveness),
      avgBiasSignal: Number(row.avg_bias_signal),
      sampleSize,
    };
  }

  async getRecruiterGlobalAverages(): Promise<RecruiterGlobalAverages | null> {
    const rows = await this.prisma.$queryRaw<RecruiterGlobalRow[]>`
      SELECT
        SUM(avg_approachability * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_approachability,
        SUM(avg_response_time * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_response_time,
        SUM(avg_timeliness * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_timeliness,
        SUM(avg_communication_quality * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_communication_quality,
        SUM(sample_size)::int AS sample_size
      FROM company_recruiter_aggregates
    `;

    const row = rows[0];
    const sampleSize = row?.sample_size ?? 0;
    if (!sampleSize) return null;

    return {
      avgApproachability: Number(row.avg_approachability),
      avgResponseTime: Number(row.avg_response_time),
      avgTimeliness: Number(row.avg_timeliness),
      avgCommunicationQuality: Number(row.avg_communication_quality),
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
