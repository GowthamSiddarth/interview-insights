// Duplicated from api/src/events/schemas/overall-review-created.event.ts
// — see round-rating-created.event.ts's own comment.
export const OVERALL_REVIEW_CREATED_V1_TOPIC = 'moderation.overall_review.created.v1';

export interface OverallReviewCreatedEventV1 {
  eventType: 'moderation.overall_review.created';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  overallReviewId: string;
  processId: string;
  candidateId: string;
  companyId: string;
  status: 'pending';
  // GitHub issue #692 (Phase 49, D104) — see api's own copy of this
  // schema for the full reasoning; unused by this service (kept for
  // byte-for-byte shape parity with the contract).
  isResubmission?: boolean;
  moderationQueueEntryId?: string;
}
