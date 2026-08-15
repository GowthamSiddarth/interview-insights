// Versioned event contract — see docs/EVENTS.md. Same shape as
// round-rating-created.event.ts, one per moderated entity type.
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
  // GitHub issue #692 (Phase 49, D104) — see round-rating-created.event.ts's
  // own comment for the full reasoning; identical here.
  isResubmission?: boolean;
  moderationQueueEntryId?: string;
}
