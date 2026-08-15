import { StaffRole } from '@prisma/client';

// Duplicated from api/src/events/schemas/staff-account-created.event.ts — same
// duplicate-rather-than-share reasoning as docs/DECISIONS.md D73/D75.
// The topic name/shape below must stay byte-for-byte identical to api's:
// this is the contract, not an independent definition — see docs/EVENTS.md.
// Published by
// StaffAccountsService.create() (GitHub issue #702, Phase 51, D104).
export const STAFF_ACCOUNT_CREATED_V1_TOPIC = 'staff.account.created.v1';

export interface StaffAccountCreatedEventV1 {
  eventType: 'staff.account.created';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  moderatorId: string;
  email: string;
  role: StaffRole;
  // The admin who created this account (StaffAuditLog's own actorId).
  actorId: string;
  // GitHub issue #705 — the one-time temporary password, delivered here
  // so the new hire actually receives it (today it's returned only in
  // the creating admin's own HTTP response, nowhere else) — same
  // plaintext-once precedent generateTemporaryPassword()'s callers
  // already establish for the HTTP response itself.
  temporaryPassword: string;
  // GitHub issue #705 — a fresh id minted per publish, not tied to any
  // moderation_queue entry (staff actions don't have one). Reused as the
  // same disambiguating role NotificationLog's moderation_queue_entry_id
  // column already plays for *.status_changed events (#686/#687): "per
  // action, not per target." create() itself only ever fires once per
  // moderatorId, but every staff.account.* event shares this same field
  // for one uniform contract — the other four (role_changed,
  // deactivated, reactivated, password_reset) genuinely can repeat on
  // the same moderatorId, and it's exactly that repetition Phase 49's
  // audit found unhandled the first time around.
  actionId: string;
}
