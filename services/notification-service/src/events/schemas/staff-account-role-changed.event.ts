import { StaffRole } from '@prisma/client';

// Duplicated from api/src/events/schemas/staff-account-role-changed.event.ts — same
// duplicate-rather-than-share reasoning as docs/DECISIONS.md D73/D75.
// The topic name/shape below must stay byte-for-byte identical to api's:
// this is the contract, not an independent definition — see docs/EVENTS.md.
// Published by
// StaffAccountsService.updateRole() (GitHub issue #702, Phase 51, D104).
export const STAFF_ACCOUNT_ROLE_CHANGED_V1_TOPIC = 'staff.account.role_changed.v1';

export interface StaffAccountRoleChangedEventV1 {
  eventType: 'staff.account.role_changed';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  moderatorId: string;
  email: string;
  oldRole: StaffRole;
  newRole: StaffRole;
  actorId: string;
  // See staff-account-created.event.ts's own comment for why this exists
  // on every staff.account.* event.
  actionId: string;
}
