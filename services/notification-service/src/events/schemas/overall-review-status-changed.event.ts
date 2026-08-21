import { ModerationRejectionReason, ModerationStatus } from '@prisma/client';

// Duplicated from api/src/events/schemas/overall-review-status-changed.event.ts
// — see round-rating-status-changed.event.ts's own comment.
export const OVERALL_REVIEW_STATUS_CHANGED_V1_TOPIC = 'moderation.overall_review.status_changed.v1';

export interface OverallReviewStatusChangedEventV1 {
  eventType: 'moderation.overall_review.status_changed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  overallReviewId: string;
  processId: string;
  candidateId: string;
  companyId: string;
  previousStatus: 'pending';
  newStatus: ModerationStatus;
  reviewedBy?: string;
  // GitHub issue #686 (Phase 49, D104) — see round-rating-status-changed
  // .event.ts's own comment. Optional, non-breaking v1 addition.
  moderationQueueEntryId?: string;
  // GitHub issue #729 (follow-up to #688, Phase 49) — see api's own
  // round-rating-status-changed.event.ts comment for why.
  rejectionReasonCategory?: ModerationRejectionReason;
  reviewNote?: string;
}
