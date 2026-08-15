// Versioned event contract — see docs/EVENTS.md. Published by
// StaffAccountsService.deactivate() (GitHub issue #702, Phase 51, D104).
export const STAFF_ACCOUNT_DEACTIVATED_V1_TOPIC = 'staff.account.deactivated.v1';

export interface StaffAccountDeactivatedEventV1 {
  eventType: 'staff.account.deactivated';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  moderatorId: string;
  email: string;
  actorId: string;
  // See staff-account-created.event.ts's own comment for why this exists
  // on every staff.account.* event.
  actionId: string;
}
