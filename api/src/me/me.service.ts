import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface MySubmissionRoundRating {
  id: string;
  roundId: string;
  roundTitle: string;
  roundType: string;
  status: string;
  difficulty: number;
  fairness: number;
  communicationFluency: number;
  attentiveness: number;
  biasSignal: number;
  technicalDepth: number | null;
  freeText: string | null;
  createdAt: Date;
}

export interface MySubmissionRecruiterRating {
  id: string;
  recruiterInteractionId: string;
  status: string;
  approachability: number;
  responseTime: number;
  timeliness: number;
  communicationQuality: number;
  freeText: string | null;
  createdAt: Date;
}

export interface MySubmissionOverallReview {
  id: string;
  status: string;
  overallExperience: number;
  wouldRecommend: boolean;
  reviewText: string | null;
  createdAt: Date;
}

export interface MyProcessSubmissions {
  processId: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  roleTitle: string;
  outcome: string;
  createdAt: Date;
  roundRatings: MySubmissionRoundRating[];
  recruiterRatings: MySubmissionRecruiterRating[];
  overallReview: MySubmissionOverallReview | null;
}

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  // GitHub issue #149 — the one read path where a candidate SHOULD see
  // their own pending/rejected/flagged content, scoped strictly to the
  // session owner via candidateId (never a request param). Grouped by
  // InterviewProcess (decided during the Phase 17 kickoff brainstorm) —
  // a candidate thinks in terms of "my interview at Company X," not
  // three disjoint entity-type lists. Every nested rating/review is
  // already guaranteed to belong to this candidate structurally (a
  // process has exactly one candidate), but every relation is filtered
  // by candidateId again anyway — defensive, not load-bearing today,
  // matching how this codebase already double-checks ownership
  // elsewhere rather than trusting the join alone.
  async findMySubmissions(candidateId: string): Promise<MyProcessSubmissions[]> {
    const processes = await this.prisma.interviewProcess.findMany({
      where: { candidateId },
      orderBy: { createdAt: 'desc' },
      include: {
        company: true,
        rounds: {
          include: {
            ratings: { where: { candidateId } },
          },
        },
        recruiterInteractions: {
          include: {
            ratings: { where: { candidateId } },
          },
        },
        overallReview: true,
      },
    });

    return processes.map((process) => ({
      processId: process.id,
      companyId: process.companyId,
      companyName: process.company.name,
      companySlug: process.company.slug,
      roleTitle: process.roleTitle,
      outcome: process.outcome,
      createdAt: process.createdAt,
      // A round only counts as a submission once it has a rating — the
      // unique([roundId, candidateId]) constraint guarantees at most one.
      roundRatings: process.rounds.flatMap((round) =>
        round.ratings.map((rating) => ({
          id: rating.id,
          roundId: round.id,
          roundTitle: round.title,
          roundType: round.roundType,
          status: rating.status,
          difficulty: rating.difficulty,
          fairness: rating.fairness,
          communicationFluency: rating.communicationFluency,
          attentiveness: rating.attentiveness,
          biasSignal: rating.biasSignal,
          technicalDepth: rating.technicalDepth,
          freeText: rating.freeText,
          createdAt: rating.createdAt,
        })),
      ),
      recruiterRatings: process.recruiterInteractions.flatMap((interaction) =>
        interaction.ratings.map((rating) => ({
          id: rating.id,
          recruiterInteractionId: interaction.id,
          status: rating.status,
          approachability: rating.approachability,
          responseTime: rating.responseTime,
          timeliness: rating.timeliness,
          communicationQuality: rating.communicationQuality,
          freeText: rating.freeText,
          createdAt: rating.createdAt,
        })),
      ),
      overallReview: process.overallReview
        ? {
            id: process.overallReview.id,
            status: process.overallReview.status,
            overallExperience: process.overallReview.overallExperience,
            wouldRecommend: process.overallReview.wouldRecommend,
            reviewText: process.overallReview.reviewText,
            createdAt: process.overallReview.createdAt,
          }
        : null,
    }));
  }
}
