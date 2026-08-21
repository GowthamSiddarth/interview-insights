import { ModerationRejectionReason, ModerationStatus } from '@prisma/client';

// Duplicated from api/src/events/schemas/company-status-changed.event.ts
// — same duplicate-rather-than-share reasoning as docs/DECISIONS.md D73/D75.
// The topic name/shape below must stay byte-for-byte identical to api's:
// this is the contract, not an independent definition — see docs/EVENTS.md.
export const COMPANY_STATUS_CHANGED_V1_TOPIC = 'moderation.company.status_changed.v1';

export interface CompanyStatusChangedEventV1 {
  eventType: 'moderation.company.status_changed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  companyId: string;
  candidateId: string;
  previousStatus: 'pending';
  newStatus: ModerationStatus;
  reviewedBy?: string;
  moderationQueueEntryId?: string;
  // GitHub issue #729 (follow-up to #688, Phase 49) — see api's own
  // round-rating-status-changed.event.ts comment for why.
  rejectionReasonCategory?: ModerationRejectionReason;
  reviewNote?: string;
}
