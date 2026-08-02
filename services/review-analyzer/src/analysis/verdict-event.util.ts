import { ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC } from '../events/schemas/round-rating-verdict-computed.event';
import { RECRUITER_RATING_VERDICT_COMPUTED_V1_TOPIC } from '../events/schemas/recruiter-rating-verdict-computed.event';
import { OVERALL_REVIEW_VERDICT_COMPUTED_V1_TOPIC } from '../events/schemas/overall-review-verdict-computed.event';
import { TriageableEntityType, VerdictResult } from './analysis.service';

// Shared by AnalysisConsumerService (a freshly-computed verdict off a
// *.created event) and ReconciliationSweepService (a re-triaged stale row,
// or — when even the retry fails — a `stalled: true` escalation event with
// no verdict at all, GitHub issue #442/#340) — one place building the
// per-entity-type topic/event shape so the two call sites can't drift.
export function buildVerdictComputedEvent(
  entityType: TriageableEntityType,
  entityId: string,
  result: VerdictResult | null,
): { topic: string; event: Record<string, unknown> } {
  const occurredAt = new Date().toISOString();
  const payload = result
    ? {
        verdict: result.verdict,
        autoApprovalEligible: result.verdict.autoApprovalEligible === true,
        confidence: result.confidence,
        model: result.model,
        promptContent: result.promptContent,
        responseText: result.responseText,
      }
    : {
        verdict: null,
        autoApprovalEligible: false,
        confidence: null,
        model: null,
        promptContent: null,
        responseText: null,
        stalled: true as const,
      };

  switch (entityType) {
    case 'round_rating':
      return {
        topic: ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC,
        event: {
          eventType: 'moderation.round_rating.verdict_computed',
          eventVersion: 1,
          occurredAt,
          roundRatingId: entityId,
          ...payload,
        },
      };
    case 'recruiter_rating':
      return {
        topic: RECRUITER_RATING_VERDICT_COMPUTED_V1_TOPIC,
        event: {
          eventType: 'moderation.recruiter_rating.verdict_computed',
          eventVersion: 1,
          occurredAt,
          recruiterRatingId: entityId,
          ...payload,
        },
      };
    case 'overall_review':
      return {
        topic: OVERALL_REVIEW_VERDICT_COMPUTED_V1_TOPIC,
        event: {
          eventType: 'moderation.overall_review.verdict_computed',
          eventVersion: 1,
          occurredAt,
          overallReviewId: entityId,
          ...payload,
        },
      };
  }
}
