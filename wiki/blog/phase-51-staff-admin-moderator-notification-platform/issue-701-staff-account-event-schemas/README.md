# Phase 51, Issue #701 — `staff.account.*` Event Schemas

*Part of Phase 51 — Staff/Admin/Moderator Notification Platform.
See `docs/ROADMAP.md` Phase 51, `docs/DECISIONS.md` D104.*

## The gap

`StaffAccountsService`'s five mutating methods — `create`, `updateRole`,
`deactivate`, `reactivate`, `resetPassword` — each end in a Postgres
write and a `StaffAuditLogService.record()` call, and nothing else. No
email, no domain event, no in-app signal reaches the affected staff
member or any other admin. An admin creating a new moderator account
gets the one-time temporary password back in their own HTTP response;
the new hire themselves never sees it anywhere. A role change,
deactivation, or password reset is silent to the person it happened to.

Phase 51 was deliberately sequenced last in the notification/
communication-chain audit (D104) so it could reuse Phase 49's
event/idempotency conventions instead of inventing a third parallel
scheme alongside the moderation-entity events (#331/#332) and the
company-request events (#698).

## The fix: five schemas under a new `staff.*` topic prefix

Every prior event type in this system lives under `moderation.*`
(`moderation.round_rating.created.v1`, `moderation.company.status_changed.v1`,
etc.) because every prior event is *about* a moderated entity. A staff
account isn't a moderated entity — it's an internal actor — so these get
their own top-level prefix instead of being shoehorned into
`moderation.*`:

```ts
export const STAFF_ACCOUNT_CREATED_V1_TOPIC = 'staff.account.created.v1';

export interface StaffAccountCreatedEventV1 {
  eventType: 'staff.account.created';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  moderatorId: string;
  email: string;
  role: StaffRole;
  actorId: string; // the admin who created this account
  // Delivered here so the new hire actually receives it — today it's
  // returned only in the creating admin's own HTTP response, nowhere else.
  temporaryPassword: string;
  actionId: string;
}
```

The other four (`role_changed`, `deactivated`, `reactivated`,
`password_reset`) follow the same shape, each adding only the context
specific to that action — `oldRole`/`newRole` for `role_changed`, a
fresh `temporaryPassword` for `password_reset`.

Two things every one of the five carries, both existing conventions
extended into new territory:

- **`actorId`** — the acting admin's id, same "who did this" field
  `StaffAuditLogService.record()` already tracks, now propagated onto
  the event itself.
- **`actionId`** — a fresh id minted per publish. This plays exactly the
  disambiguating role `moderationQueueEntryId` already plays for
  `*.status_changed` events since #686/#687: `notification-service`'s
  `NotificationLog` dedup key needs *something* in its fourth column to
  tell two events on the same entity apart, and staff actions have no
  `moderation_queue` entry to key off. Several of these event types can
  legitimately repeat on the same `moderatorId` — a moderator can be
  promoted, demoted, and promoted again — so without a per-action
  disambiguator, the second role change would silently dedupe against
  the first and never send an email.

Duplicated into `notification-service`'s own schema files per the
existing D73/D75 "duplicate-rather-than-share" pattern, each carrying
the standard header comment pointing back at the `api` original. The
service's minimal read-only Prisma mirror also gained the `StaffRole`
enum — no migration needed, since the enum already exists in the shared
Postgres database from `api`'s own Phase 42 migration.

`docs/EVENTS.md`'s table now lists seventeen event types. This issue was
schema-only — no publisher (`#702`) or consumer (`#705`) wiring yet.

## Verification

No runtime behavior changes with schema-only additions; verified via
`tsc --noEmit` across both `api` and `notification-service`, and a
by-hand diff check that each duplicated schema file matches its `api`
original field-for-field.
