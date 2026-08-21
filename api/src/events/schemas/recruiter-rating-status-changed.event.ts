import { ModerationRejectionReason, ModerationStatus } from '@prisma/client';

// Versioned event contract — see docs/EVENTS.md.
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
  // .event.ts's own comment for why. Optional, non-breaking addition to
  // the existing v1 contract per docs/EVENTS.md.
  moderationQueueEntryId?: string;
  // GitHub issue #729 (follow-up to #688, Phase 49) — see
  // round-rating-status-changed.event.ts's own comment for why.
  rejectionReasonCategory?: ModerationRejectionReason;
  reviewNote?: string;
}
