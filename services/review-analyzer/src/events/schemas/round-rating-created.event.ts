// Duplicated from api/src/events/schemas/round-rating-created.event.ts —
// same duplicate-rather-than-share reasoning as docs/DECISIONS.md D73/D75,
// confirmed for this service in D81. The topic name/shape below must stay
// byte-for-byte identical to api's: this is the contract, not an
// independent definition — see docs/EVENTS.md.
export const ROUND_RATING_CREATED_V1_TOPIC = 'moderation.round_rating.created.v1';

export interface RoundRatingCreatedEventV1 {
  eventType: 'moderation.round_rating.created';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  roundRatingId: string;
  roundId: string;
  candidateId: string;
  companyId: string;
  status: 'pending';
  // GitHub issue #692 (Phase 49, D104) — see api's own copy of this
  // schema for the full reasoning; identical here. This service doesn't
  // read either field (a re-triage runs the same way regardless of
  // whether the trigger was a first-time submission or a resubmission),
  // kept only for byte-for-byte shape parity with the contract.
  isResubmission?: boolean;
  moderationQueueEntryId?: string;
}
