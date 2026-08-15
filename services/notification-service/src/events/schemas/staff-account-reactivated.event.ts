// Duplicated from api/src/events/schemas/staff-account-reactivated.event.ts — same
// duplicate-rather-than-share reasoning as docs/DECISIONS.md D73/D75.
// The topic name/shape below must stay byte-for-byte identical to api's:
// this is the contract, not an independent definition — see docs/EVENTS.md.
// Published by
// StaffAccountsService.reactivate() (GitHub issue #702, Phase 51, D104).
export const STAFF_ACCOUNT_REACTIVATED_V1_TOPIC = 'staff.account.reactivated.v1';

export interface StaffAccountReactivatedEventV1 {
  eventType: 'staff.account.reactivated';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  moderatorId: string;
  email: string;
  actorId: string;
  // See staff-account-created.event.ts's own comment for why this exists
  // on every staff.account.* event.
  actionId: string;
}
