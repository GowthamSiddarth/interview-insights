// Versioned event contract — see docs/EVENTS.md. Same shape as
// round-rating-created.event.ts, one per moderated entity type.
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
}
