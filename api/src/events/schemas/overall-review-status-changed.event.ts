import { ModerationStatus } from '@prisma/client';

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
}
