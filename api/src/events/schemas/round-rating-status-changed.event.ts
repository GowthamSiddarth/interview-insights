import { ModerationStatus } from '@prisma/client';

// Versioned event contract — see docs/EVENTS.md. Published from
// ModerationService.review() once a round rating's moderation decision
// commits (approve/reject/flag) — GitHub issue #332.
export const ROUND_RATING_STATUS_CHANGED_V1_TOPIC = 'moderation.round_rating.status_changed.v1';

export interface RoundRatingStatusChangedEventV1 {
  eventType: 'moderation.round_rating.status_changed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  roundRatingId: string;
  roundId: string;
  candidateId: string;
  companyId: string;
  previousStatus: 'pending'; // review() only ever runs against an unreviewed entry
  newStatus: ModerationStatus;
  reviewedBy?: string; // ModerationActionDto.reviewedBy is optional — no admin-user system yet
}
