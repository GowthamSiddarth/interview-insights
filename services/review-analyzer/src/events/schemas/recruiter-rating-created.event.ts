// Duplicated from api/src/events/schemas/recruiter-rating-created.event.ts
// — see round-rating-created.event.ts's own comment.
export const RECRUITER_RATING_CREATED_V1_TOPIC = 'moderation.recruiter_rating.created.v1';

export interface RecruiterRatingCreatedEventV1 {
  eventType: 'moderation.recruiter_rating.created';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  recruiterRatingId: string;
  recruiterInteractionId: string;
  candidateId: string;
  companyId: string;
  status: 'pending';
  // GitHub issue #692 (Phase 49, D104) — see api's own copy of this
  // schema for the full reasoning; unused by this service (kept for
  // byte-for-byte shape parity with the contract).
  isResubmission?: boolean;
  moderationQueueEntryId?: string;
}
