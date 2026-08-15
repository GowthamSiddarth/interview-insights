// Versioned event contract — see docs/EVENTS.md. Same shape as
// round-rating-created.event.ts, but for a create-company request
// (GitHub issue #698, Phase 50, D104) — previously out of scope for the
// *.created event family entirely (D53's "moderated entity types" never
// included `company`). candidateId is required on the event itself (a
// candidate always exists once this is published), but the publish call
// is skipped entirely for a seed/admin-created company with no
// candidateId at all — see ModerationService.publishCreatedEvent()'s own
// 'company' case.
export const COMPANY_CREATED_V1_TOPIC = 'moderation.company.created.v1';

export interface CompanyCreatedEventV1 {
  eventType: 'moderation.company.created';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  companyId: string;
  candidateId: string;
  status: 'pending';
  // GitHub issue #692 (Phase 49, D104) — present on the type only for
  // structural consistency with the other three *.created events (so a
  // consumer treating CreatedEvent as one union doesn't need a
  // company-specific special case); never actually set by
  // ModerationService.publishCreatedEvent()'s 'company' case today —
  // CompaniesService.update() doesn't call it with a `resubmission`
  // option at all (#697), so a company resubmission produces no ack
  // event, only the eventual status_changed one.
  isResubmission?: boolean;
  moderationQueueEntryId?: string;
}
