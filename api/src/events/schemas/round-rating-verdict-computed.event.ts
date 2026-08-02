// Duplicated from services/review-analyzer/src/events/schemas/
// round-rating-verdict-computed.event.ts — same reasoning as the *.created
// schemas' own duplicate-rather-than-share precedent (docs/DECISIONS.md
// D73/D75), just in the other direction: review-analyzer is the producer of
// this one, api the consumer. The topic name/shape below must stay
// byte-for-byte identical to review-analyzer's copy — this is the contract,
// not an independent definition, see docs/EVENTS.md.
export const ROUND_RATING_VERDICT_COMPUTED_V1_TOPIC = 'moderation.round_rating.verdict_computed.v1';

export interface RoundRatingVerdictComputedEventV1 {
  eventType: 'moderation.round_rating.verdict_computed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  roundRatingId: string;
  verdict: Record<string, unknown> | null;
  autoApprovalEligible: boolean;
  confidence: number | null;
  model: string | null;
  promptContent: string | null;
  responseText: string | null;
  stalled?: true;
}
