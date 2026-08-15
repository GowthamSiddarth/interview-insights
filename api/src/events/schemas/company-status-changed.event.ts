import { ModerationStatus } from '@prisma/client';

// Versioned event contract — see docs/EVENTS.md. Published from
// ModerationService.review() once a company-creation request's
// moderation decision commits (approve/reject) — GitHub issue #698
// (Phase 50, D104), previously out of scope for the *.status_changed
// event family entirely (same D53 scoping gap company-created.event.ts's
// own comment describes).
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
  // GitHub issue #697 (Phase 50) — a candidate can edit and resubmit
  // their own rejected/pending company request (reenqueue()), so a
  // company can receive a second status_changed event too. Required so
  // notification-service's per-queue-entry dedup key (#686/#687) covers
  // this event domain from day one, rather than reintroducing the exact
  // bug D104's audit found in the original three entity types.
  moderationQueueEntryId?: string;
}
