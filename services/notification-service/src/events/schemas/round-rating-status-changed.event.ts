import { ModerationRejectionReason, ModerationStatus } from '@prisma/client';

// Duplicated from api/src/events/schemas/round-rating-status-changed.event.ts
// — same duplicate-rather-than-share reasoning as docs/DECISIONS.md D73/D75.
// The topic name/shape below must stay byte-for-byte identical to api's:
// this is the contract, not an independent definition — see docs/EVENTS.md.
export const ROUND_RATING_STATUS_CHANGED_V1_TOPIC = 'moderation.round_rating.status_changed.v1';

export interface RoundRatingStatusChangedEventV1 {
  eventType: 'moderation.round_rating.status_changed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  roundRatingId: string;
  roundId: string;
  candidateId: string;
  companyId: string;
  previousStatus: 'pending';
  newStatus: ModerationStatus;
  reviewedBy?: string;
  // GitHub issue #686 (Phase 49, D104) — see api's own
  // round-rating-status-changed.event.ts comment for why. Optional,
  // non-breaking addition to the existing v1 contract per docs/EVENTS.md.
  moderationQueueEntryId?: string;
  // GitHub issue #729 (follow-up to #688, Phase 49) — see api's own
  // round-rating-status-changed.event.ts comment for why.
  rejectionReasonCategory?: ModerationRejectionReason;
  reviewNote?: string;
}
