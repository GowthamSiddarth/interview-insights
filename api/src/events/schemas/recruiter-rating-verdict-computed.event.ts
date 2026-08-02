// Duplicated from services/review-analyzer/src/events/schemas/
// recruiter-rating-verdict-computed.event.ts — see round-rating-verdict-
// computed.event.ts's own comment.
export const RECRUITER_RATING_VERDICT_COMPUTED_V1_TOPIC = 'moderation.recruiter_rating.verdict_computed.v1';

export interface RecruiterRatingVerdictComputedEventV1 {
  eventType: 'moderation.recruiter_rating.verdict_computed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  recruiterRatingId: string;
  verdict: Record<string, unknown> | null;
  autoApprovalEligible: boolean;
  confidence: number | null;
  model: string | null;
  promptContent: string | null;
  responseText: string | null;
  stalled?: true;
}
