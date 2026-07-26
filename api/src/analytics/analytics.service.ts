import { Injectable } from '@nestjs/common';
import { RoundType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  GlobalAveragesService,
  OverallGlobalAverages,
  RecruiterGlobalAverages,
  RoundTypeGlobalAverages,
} from './global-averages.service';
import { computeShrinkageScore } from './shrinkage-score.util';

export interface RoundTypeAnalytics {
  roundType: RoundType;
  sampleSize: number;
  scores: {
    difficulty: number | null;
    fluency: number | null;
    clarity: number | null;
    focus: number | null;
  };
}

export interface RecruiterAnalytics {
  sampleSize: number;
  scores: {
    reachability: number | null;
    responsiveness: number | null;
    guidelinesShared: number | null;
  };
}

export interface OverallAnalytics {
  sampleSize: number;
  scores: {
    overallExperience: number | null;
    wouldRecommendPct: number | null;
  };
}

export interface CompanyAnalytics {
  companyId: string;
  roundTypes: RoundTypeAnalytics[];
  recruiter: RecruiterAnalytics | null;
  overall: OverallAnalytics | null;
}

interface CompanyRoundTypeRow {
  round_type: RoundType;
  avg_difficulty: string;
  avg_fluency: string;
  avg_clarity: string;
  avg_focus: string;
  sample_size: number;
}
interface CompanyRecruiterRow {
  avg_reachability: string;
  avg_responsiveness: string;
  avg_guidelines_shared: string;
  sample_size: number;
}
interface CompanyOverallRow {
  avg_overall_experience: string;
  pct_would_recommend: string;
  sample_size: number;
}

// Wires the Phase 4 issue #7 materialized views and issue #8 shrinkage
// scoring into the public analytics response. Every score is accompanied
// by its sample_size, always (docs/DATA_MODEL.md D4) — never a hidden gate.
//
// Scope note: docs/DATA_MODEL.md's "fall back to the company-wide
// aggregate when a round-type slice is under the floor" is deferred, not
// implemented here — this issue's acceptance criteria only requires
// returning null (with sample_size) below the floor, and the fallback adds
// real complexity (a second grain of "company-wide across round types" to
// compute and label) that isn't justified without evidence it's needed.
// Revisit once the dashboard (issue #10) or real usage shows it matters.
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly globalAveragesService: GlobalAveragesService,
  ) {}

  async getCompanyAnalytics(companyId: string): Promise<CompanyAnalytics> {
    // 404s via PrismaExceptionFilter (P2025) if the company doesn't exist
    // or isn't approved yet (GitHub issue #369, Phase 35) — a pending
    // company's analytics must never leak that it exists.
    await this.prisma.company.findFirstOrThrow({ where: { id: companyId, status: 'approved' } });

    const roundTypeRows = await this.prisma.$queryRaw<CompanyRoundTypeRow[]>`
      SELECT round_type, avg_difficulty, avg_fluency, avg_clarity, avg_focus, sample_size
      FROM company_round_type_aggregates
      WHERE company_id = ${companyId}::uuid
    `;
    const roundTypes = await Promise.all(
      roundTypeRows.map((row) => this.buildRoundTypeAnalytics(row)),
    );

    const recruiterRows = await this.prisma.$queryRaw<CompanyRecruiterRow[]>`
      SELECT avg_reachability, avg_responsiveness, avg_guidelines_shared, sample_size
      FROM company_recruiter_aggregates
      WHERE company_id = ${companyId}::uuid
    `;
    const recruiter = recruiterRows[0]
      ? await this.buildRecruiterAnalytics(recruiterRows[0])
      : null;

    const overallRows = await this.prisma.$queryRaw<CompanyOverallRow[]>`
      SELECT avg_overall_experience, pct_would_recommend, sample_size
      FROM company_overall_aggregates
      WHERE company_id = ${companyId}::uuid
    `;
    const overall = overallRows[0] ? await this.buildOverallAnalytics(overallRows[0]) : null;

    return { companyId, roundTypes, recruiter, overall };
  }

  private async buildRoundTypeAnalytics(row: CompanyRoundTypeRow): Promise<RoundTypeAnalytics> {
    const globalAverages = await this.globalAveragesService.getRoundTypeGlobalAverages(
      row.round_type,
    );
    const n = row.sample_size;
    const score = (companyAvg: string, metric: keyof RoundTypeGlobalAverages) =>
      globalAverages ? computeShrinkageScore(n, Number(companyAvg), globalAverages[metric]) : null;

    return {
      roundType: row.round_type,
      sampleSize: n,
      scores: {
        difficulty: score(row.avg_difficulty, 'avgDifficulty'),
        fluency: score(row.avg_fluency, 'avgFluency'),
        clarity: score(row.avg_clarity, 'avgClarity'),
        focus: score(row.avg_focus, 'avgFocus'),
      },
    };
  }

  private async buildRecruiterAnalytics(row: CompanyRecruiterRow): Promise<RecruiterAnalytics> {
    const globalAverages = await this.globalAveragesService.getRecruiterGlobalAverages();
    const n = row.sample_size;
    const score = (companyAvg: string, metric: keyof RecruiterGlobalAverages) =>
      globalAverages ? computeShrinkageScore(n, Number(companyAvg), globalAverages[metric]) : null;

    return {
      sampleSize: n,
      scores: {
        reachability: score(row.avg_reachability, 'avgReachability'),
        responsiveness: score(row.avg_responsiveness, 'avgResponsiveness'),
        guidelinesShared: score(row.avg_guidelines_shared, 'avgGuidelinesShared'),
      },
    };
  }

  private async buildOverallAnalytics(row: CompanyOverallRow): Promise<OverallAnalytics> {
    const globalAverages = await this.globalAveragesService.getOverallGlobalAverages();
    const n = row.sample_size;
    const score = (companyAvg: string, metric: keyof OverallGlobalAverages) =>
      globalAverages ? computeShrinkageScore(n, Number(companyAvg), globalAverages[metric]) : null;

    return {
      sampleSize: n,
      scores: {
        overallExperience: score(row.avg_overall_experience, 'avgOverallExperience'),
        wouldRecommendPct: score(row.pct_would_recommend, 'pctWouldRecommend'),
      },
    };
  }
}
