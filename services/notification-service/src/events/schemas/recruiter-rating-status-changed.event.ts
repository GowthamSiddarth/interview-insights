import { ModerationStatus } from '@prisma/client';

// Duplicated from api/src/events/schemas/recruiter-rating-status-changed.event.ts
// — see round-rating-status-changed.event.ts's own comment.
export const RECRUITER_RATING_STATUS_CHANGED_V1_TOPIC = 'moderation.recruiter_rating.status_changed.v1';

export interface RecruiterRatingStatusChangedEventV1 {
  eventType: 'moderation.recruiter_rating.status_changed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  recruiterRatingId: string;
  recruiterInteractionId: string;
  candidateId: string;
  companyId: string;
  previousStatus: 'pending';
  newStatus: ModerationStatus;
  reviewedBy?: string;
  // GitHub issue #686 (Phase 49, D104) — see round-rating-status-changed
  // .event.ts's own comment. Optional, non-breaking v1 addition.
  moderationQueueEntryId?: string;
}
