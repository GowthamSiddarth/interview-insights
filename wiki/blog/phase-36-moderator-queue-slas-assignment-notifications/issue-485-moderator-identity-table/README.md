# Phase 36, Issue #485 — Moderator Identity Table, Replacing the Shared Admin Credential

*Part of Phase 36 — Moderator Queue SLAs, Assignment & Notifications. See
`docs/ROADMAP.md` Phase 36 and `docs/DECISIONS.md` D80.*

## The gap this closed

Since Phase 18, admin auth was a single shared credential:
`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` compared directly against
whatever a login request sent. That was a deliberate, documented scope
boundary at the time ("one moderator today; revisit if/when a second
admin exists") — but Phase 36 needs `claim`/`release` (#487) and
`reviewedBy` to eventually point at a real identity, not free text.
There was no table to point at. This issue builds one, without yet
building multi-moderator admin itself — laying groundwork, not solving
assignment.

## Key concept: upsert-on-boot, not seed-once

The single moderator today is still entirely env-configured
(`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`/`ADMIN_EMAIL`) — a `moderators`
table with no seeding story would just move the credential from env
vars to a database row nobody ever populates. `AdminAuthService` gained
`onModuleInit()`, upserting the env-configured moderator on *every*
boot, not a one-time migration-time seed:

```ts
async onModuleInit() {
  const username = getRequiredAdminEnv('ADMIN_USERNAME');
  const passwordHash = getRequiredAdminEnv('ADMIN_PASSWORD_HASH');
  const email = getRequiredAdminEnv('ADMIN_EMAIL');

  await this.prisma.moderator.upsert({
    where: { username },
    create: { username, passwordHash, email },
    update: { passwordHash, email },
  });
}
```

This preserves a real operational property the old direct-env-comparison
approach had for free: rotating `ADMIN_PASSWORD_HASH` in the secret
store takes effect on the next restart, not "never, because the row was
already seeded." A fresh database also has no rows to seed from — boot
is the only point in this system's lifecycle guaranteed to run before
the first login attempt.

## Key concept: `AdminSessionPayload` gains `id`, not just a bigger `username`

`validateAdmin()` used to return `{ username }` on success — enough to
compare against a hardcoded expected value, useless as a real foreign
key. It now looks the row up and returns `{ id: moderator.id, username:
moderator.username }`. That `id` is what makes `claim`/`release` (#487)
possible at all: `ModerationController`'s routes read
`AdminJwtAuthGuard`'s own `req.user.id` and pass it straight through as
the claiming moderator, never a client-supplied value. Nothing about the
JWT session shape itself changed otherwise — `AdminSessionPayload` is
still signed into the same `admin_session` cookie, `GET /auth/admin/me`
still returns it directly.

## Step-by-step: what actually got built and verified

1. New `Moderator` Prisma model (`id`/`username`/`password_hash`/
   `email`/`created_at`) — hand-authored migration
   (`20260803000000_add_moderator_table`, applied via `prisma migrate
   deploy`, not `migrate dev` — the same shadow-database replay gap
   every migration against this schema hits).
2. `AdminAuthService.validateAdmin()` rewritten to query the table
   instead of comparing env vars directly; `onModuleInit()` added for
   the upsert-on-boot seeding above.
3. New required `ADMIN_EMAIL` env var (documented in `.env.example`,
   wired into CI's `api` job) — the table's `email` column has no
   default, and this is also the address Phase 36's later breach
   notifications (#488/#489) will eventually reach, once a second
   moderator actually exists to notify.
4. `AdminSessionPayload` gained `id`; every existing admin-auth spec
   updated for the new shape.
5. Full unit + e2e suites green — admin login, session checks, and
   every existing moderation-queue e2e spec (which all log in as the
   env-seeded moderator) kept working unchanged, since the externally
   observable login behavior is identical.

## What this enabled

`claim`/`release` (#487) and the SLA-breach notification path (#488/
#489) both needed a real moderator identity to attach to a row —
`reviewedBy` staying free text was fine when there was nothing to link
it to, but `claimed_by` as an actual foreign key (#486) only works once
`moderators` exists. This issue is pure groundwork: no user-facing
behavior changed, but every later issue in Phase 36 builds directly on
`Moderator.id`.
