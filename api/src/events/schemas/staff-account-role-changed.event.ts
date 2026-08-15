import { StaffRole } from '@prisma/client';

// Versioned event contract — see docs/EVENTS.md. Published by
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
