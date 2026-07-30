import { ModerationStatus } from '@prisma/client';

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
}
