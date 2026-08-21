import { Injectable } from '@nestjs/common';
import { ModerationEntityType, ModerationRejectionReason } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewSearchService } from '../search/review-search.service';

export interface MySubmissionRoundRating {
  id: string;
  roundId: string;
  roundTitle: string | null;
  roundType: string;
  status: string;
  difficulty: number;
  fluency: number;
  clarity: number;
  focus: number;
  technicalDepth: number | null;
  freeText: string | null;
  createdAt: Date;
  // GitHub issue #729 (follow-up to #688, Phase 49) — the moderator's own
  // stated reason, when this item's current status is 'rejected'/
  // 'permanently_rejected'. Null otherwise, or if the rejection predates
  // #688 (no backfill exists for those, same "honestly unknown" reasoning
  // as ModerationQueuePriorReview's own comment).
  rejectionReasonCategory: ModerationRejectionReason | null;
  reviewNote: string | null;
}

export interface MySubmissionRecruiterRating {
  id: string;
  recruiterInteractionId: string;
  status: string;
  reachability: number;
  responsiveness: number;
  guidelinesShared: number;
  rejectionMessageAuthenticity: number | null;
  freeText: string | null;
  createdAt: Date;
  rejectionReasonCategory: ModerationRejectionReason | null;
  reviewNote: string | null;
}

export interface MySubmissionOverallReview {
  id: string;
  status: string;
  overallExperience: number;
  wouldRecommend: boolean;
  reviewText: string | null;
  createdAt: Date;
  rejectionReasonCategory: ModerationRejectionReason | null;
  reviewNote: string | null;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviewSearchService: ReviewSearchService,
  ) {}

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

    // GitHub issue #729 (follow-up to #688, Phase 49) — rejectionReasonCategory/
    // reviewNote live on moderation_queue, not on the rated entity itself
    // (the reference is polymorphic, docs/DATA_MODEL.md), so they need
    // their own batched lookup, same OR-of-refs shape
    // ModerationService.fetchPriorReviews() already established. Only the
    // *most recent* reviewed entry per entityId is relevant here — a
    // candidate's current rejected status corresponds to exactly one
    // queue entry (the one that set it; a later resubmission would have
    // already reenqueue()'d and changed status away from rejected).
    const rejectionReasonsByKey = await this.fetchLatestRejectionReasons(
      processes.flatMap((process) => [
        ...process.rounds.flatMap((round) =>
          round.ratings.map((rating) => ({ entityType: 'round_rating' as const, entityId: rating.id })),
        ),
        ...process.recruiterInteractions.flatMap((interaction) =>
          interaction.ratings.map((rating) => ({ entityType: 'recruiter_rating' as const, entityId: rating.id })),
        ),
        ...(process.overallReview
          ? [{ entityType: 'overall_review' as const, entityId: process.overallReview.id }]
          : []),
      ]),
    );

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
          fluency: rating.fluency,
          clarity: rating.clarity,
          focus: rating.focus,
          technicalDepth: rating.technicalDepth,
          freeText: rating.freeText,
          createdAt: rating.createdAt,
          ...(rejectionReasonsByKey.get(`round_rating:${rating.id}`) ?? {
            rejectionReasonCategory: null,
            reviewNote: null,
          }),
        })),
      ),
      recruiterRatings: process.recruiterInteractions.flatMap((interaction) =>
        interaction.ratings.map((rating) => ({
          id: rating.id,
          recruiterInteractionId: interaction.id,
          status: rating.status,
          reachability: rating.reachability,
          responsiveness: rating.responsiveness,
          guidelinesShared: rating.guidelinesShared,
          rejectionMessageAuthenticity: rating.rejectionMessageAuthenticity,
          freeText: rating.freeText,
          createdAt: rating.createdAt,
          ...(rejectionReasonsByKey.get(`recruiter_rating:${rating.id}`) ?? {
            rejectionReasonCategory: null,
            reviewNote: null,
          }),
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
            ...(rejectionReasonsByKey.get(`overall_review:${process.overallReview.id}`) ?? {
              rejectionReasonCategory: null,
              reviewNote: null,
            }),
          }
        : null,
    }));
  }

  // GitHub issue #729 (follow-up to #688, Phase 49) — same "OR of
  // entityType/entityId refs, ordered reviewedAt desc" shape
  // ModerationService.fetchPriorReviews() already established, just
  // keeping only the first (most recent) hit per key instead of a full
  // history array — /me only ever needs "why is this currently
  // rejected," not the whole resubmission trail (that's the moderator
  // queue's own job, ModerationQueuePriorReview).
  private async fetchLatestRejectionReasons(
    refs: Array<{ entityType: ModerationEntityType; entityId: string }>,
  ): Promise<Map<string, { rejectionReasonCategory: ModerationRejectionReason | null; reviewNote: string | null }>> {
    const byKey = new Map<
      string,
      { rejectionReasonCategory: ModerationRejectionReason | null; reviewNote: string | null }
    >();
    if (refs.length === 0) return byKey;

    const rows = await this.prisma.moderationQueueEntry.findMany({
      where: { reviewedAt: { not: null }, OR: refs },
      orderBy: { reviewedAt: 'desc' },
      select: { entityType: true, entityId: true, rejectionReasonCategory: true, reviewNote: true },
    });

    for (const row of rows) {
      const key = `${row.entityType}:${row.entityId}`;
      if (!byKey.has(key)) {
        byKey.set(key, { rejectionReasonCategory: row.rejectionReasonCategory, reviewNote: row.reviewNote });
      }
    }
    return byKey;
  }

  // GitHub issue #151 (GDPR erasure). Deletes every row this candidate
  // owns — their moderated content (all statuses), the structural
  // entities that only exist because of this candidate's account
  // (InterviewProcess/Round/RecruiterInteraction — a process has exactly
  // one candidate, so unlike Update/Delete's #150 scope, full erasure
  // does reach these), verification/login tokens, and finally the
  // candidate row itself. Deliberately delete, not anonymize: none of
  // this candidate's raw identity (email) is stored anywhere to begin
  // with (only an HMAC hash), and the public aggregates this content
  // fed are already de-identified statistics, out of GDPR scope once
  // computed — nothing here needs a tombstone row to stay consistent.
  //
  // The shared `Recruiter` row (per-company internal identity,
  // referenced by potentially many candidates' RecruiterInteractions,
  // CLAUDE.md hard constraint #1) is deliberately never touched — only
  // this candidate's own RecruiterInteraction rows are deleted, not the
  // Recruiter they point at.
  //
  // Deletion order matters — every delete here must remove a table's
  // rows before any other table still holding a foreign key to them:
  // RoundRating/RecruiterRating/OverallReview (reference Candidate,
  // Round/RecruiterInteraction) first, then Round/RecruiterInteraction
  // (reference InterviewProcess), then InterviewProcess itself
  // (references Candidate), then CandidateVerificationToken/
  // CandidatePasswordResetToken/EditThrottleState (GitHub issue #788,
  // Phase 53 — both ON DELETE RESTRICT against Candidate, previously
  // missing here entirely: any candidate who ever reset a password or
  // made any edit got a 500 instead of erasure), then Candidate last.
  // moderation_queue has no FK (docs/DATA_MODEL.md) — cleaned up via
  // entityId lists gathered up front, same idea as issue #150's
  // removeQueueEntries(), just batched by array here instead of one
  // entity at a time.
  async eraseMe(candidateId: string): Promise<void> {
    const [roundRatings, recruiterRatings, overallReviews, processes] = await Promise.all([
      this.prisma.roundRating.findMany({ where: { candidateId }, select: { id: true, status: true } }),
      this.prisma.recruiterRating.findMany({ where: { candidateId }, select: { id: true } }),
      this.prisma.overallReview.findMany({ where: { candidateId }, select: { id: true } }),
      this.prisma.interviewProcess.findMany({ where: { candidateId }, select: { id: true } }),
    ]);

    const roundRatingIds = roundRatings.map((r) => r.id);
    const recruiterRatingIds = recruiterRatings.map((r) => r.id);
    const overallReviewIds = overallReviews.map((r) => r.id);
    const processIds = processes.map((p) => p.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.moderationQueueEntry.deleteMany({
        where: { entityType: 'round_rating', entityId: { in: roundRatingIds } },
      });
      await tx.moderationQueueEntry.deleteMany({
        where: { entityType: 'recruiter_rating', entityId: { in: recruiterRatingIds } },
      });
      await tx.moderationQueueEntry.deleteMany({
        where: { entityType: 'overall_review', entityId: { in: overallReviewIds } },
      });

      await tx.roundRating.deleteMany({ where: { candidateId } });
      await tx.recruiterRating.deleteMany({ where: { candidateId } });
      await tx.overallReview.deleteMany({ where: { candidateId } });

      await tx.round.deleteMany({ where: { processId: { in: processIds } } });
      await tx.recruiterInteraction.deleteMany({ where: { processId: { in: processIds } } });

      await tx.interviewProcess.deleteMany({ where: { candidateId } });
      await tx.candidateVerificationToken.deleteMany({ where: { candidateId } });
      await tx.candidatePasswordResetToken.deleteMany({ where: { candidateId } });
      await tx.editThrottleState.deleteMany({ where: { candidateId } });
      await tx.candidate.delete({ where: { id: candidateId } });
    });

    // Outside the transaction, best-effort — same D16/D17 pattern as
    // every other search-index mutation: only ever runs after the DB
    // delete has already committed, and only round_rating is ever
    // indexed (D17 scope note), so only the approved ones need removal.
    await Promise.all(
      roundRatings
        .filter((r) => r.status === 'approved')
        .map((r) => this.reviewSearchService.removeReview(r.id)),
    );
  }
}
