import { ModerationRejectionReason, ModerationStatus } from '@prisma/client';

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
  // GitHub issue #686 (Phase 49, D104) — the moderation_queue row this
  // decision was made on. A candidate can edit a rejected/flagged
  // entity and get re-enqueued (reenqueue()), which creates a *new*
  // moderation_queue row for the same entity — without this,
  // notification-service's idempotency key (candidateId + entityId
  // only) can't tell "already notified about this decision" from
  // "notified about a *previous* decision on the same entity" (#687).
  // Optional, non-breaking addition to the existing v1 contract per
  // docs/EVENTS.md — no version bump needed.
  moderationQueueEntryId?: string;
  // GitHub issue #729 (follow-up to #688, Phase 49) — a moderator's own
  // stated rejection reason, so the rejection email and /me can show it
  // instead of a fixed generic message. Only ever set on a
  // 'rejected'/'permanently_rejected' newStatus (reject() is the only
  // caller that gives these real meaning) — same optional, non-breaking
  // addition shape as moderationQueueEntryId above.
  rejectionReasonCategory?: ModerationRejectionReason;
  reviewNote?: string;
}
