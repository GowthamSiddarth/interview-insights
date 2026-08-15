// Duplicated from api/src/events/schemas/company-created.event.ts — same
// duplicate-rather-than-share reasoning as docs/DECISIONS.md D73/D75.
// The topic name/shape below must stay byte-for-byte identical to api's:
// this is the contract, not an independent definition — see docs/EVENTS.md.
export const COMPANY_CREATED_V1_TOPIC = 'moderation.company.created.v1';

export interface CompanyCreatedEventV1 {
  eventType: 'moderation.company.created';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  companyId: string;
  candidateId: string;
  status: 'pending';
  // Present for structural consistency only — see api's own copy of this
  // schema for why it's never actually set.
  isResubmission?: boolean;
  moderationQueueEntryId?: string;
}
