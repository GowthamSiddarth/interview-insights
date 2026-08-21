import { ModerationRejectionReason, ModerationStatus } from '@prisma/client';

// Versioned event contract — see docs/EVENTS.md.
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
  // .event.ts's own comment for why. Optional, non-breaking addition to
  // the existing v1 contract per docs/EVENTS.md.
  moderationQueueEntryId?: string;
  // GitHub issue #729 (follow-up to #688, Phase 49) — see
  // round-rating-status-changed.event.ts's own comment for why.
  rejectionReasonCategory?: ModerationRejectionReason;
  reviewNote?: string;
}
