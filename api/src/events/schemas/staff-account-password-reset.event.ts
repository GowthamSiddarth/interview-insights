// Versioned event contract — see docs/EVENTS.md. Published by
// StaffAccountsService.resetPassword() (GitHub issue #702, Phase 51,
// D104).
export const STAFF_ACCOUNT_PASSWORD_RESET_V1_TOPIC = 'staff.account.password_reset.v1';

export interface StaffAccountPasswordResetEventV1 {
  eventType: 'staff.account.password_reset';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  moderatorId: string;
  email: string;
  actorId: string;
  // GitHub issue #705 — see staff-account-created.event.ts's own comment
  // for the plaintext-once reasoning; identical here.
  temporaryPassword: string;
  // See staff-account-created.event.ts's own comment for why this exists
  // on every staff.account.* event.
  actionId: string;
}
