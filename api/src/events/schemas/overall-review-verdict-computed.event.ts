// Duplicated from services/review-analyzer/src/events/schemas/
// overall-review-verdict-computed.event.ts — see round-rating-verdict-
// computed.event.ts's own comment.
export const OVERALL_REVIEW_VERDICT_COMPUTED_V1_TOPIC = 'moderation.overall_review.verdict_computed.v1';

export interface OverallReviewVerdictComputedEventV1 {
  eventType: 'moderation.overall_review.verdict_computed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  overallReviewId: string;
  verdict: Record<string, unknown> | null;
  autoApprovalEligible: boolean;
  confidence: number | null;
  model: string | null;
  promptContent: string | null;
  responseText: string | null;
  stalled?: true;
}
