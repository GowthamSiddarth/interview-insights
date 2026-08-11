# Phase 42, Issue #589 — Staff Account Management Endpoints, Self-Service Password Change, Audit Logging

*Part of Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling.
See `docs/ROADMAP.md` Phase 42 and `docs/DECISIONS.md` D99.*

## The gap this closed

Everything up to this issue could check *whether* a role was allowed to
do something. Nothing could actually create a second account. D99's
credential model — root stays imperative, every other account is
created through admin tools by an existing `ADMIN` — had no tools yet.
This issue built them: a `StaffAccountsModule` for admin-driven account
lifecycle, a self-service password-change endpoint available to every
role, and the `staff_audit_log` writes #586's schema made room for but
nothing had populated yet.

## Key concept: passwords are generated, never chosen, and shown exactly once

```ts
export function generateTemporaryPassword(): string {
  return randomBytes(18).toString('base64');
}
```

Same entropy and encoding as `rotate-admin-credentials.sh`'s own
`openssl rand -base64 24` — no coincidence, this reuses the UX that
script already established for the root account. `create()` and
`resetPassword()` both generate one of these, bcrypt-hash it for
storage, and return the plaintext exactly once in the HTTP response
body. Nothing about this password is ever logged, persisted outside the
`password_hash` column, or retrievable a second time — the same
discipline the root-admin rotation flow already had, now extended to
every account instead of just one.

## Key concept: letting Prisma's own errors do the HTTP-status mapping

```ts
async updateRole(actorId: string, targetId: string, role: StaffRole) {
  const before = await this.prisma.moderator.findUniqueOrThrow({
    where: { id: targetId },
    select: { role: true },
  });
  const updated = await this.prisma.moderator.update({
    where: { id: targetId },
    data: { role },
    select: STAFF_ACCOUNT_SELECT,
  });
  await this.staffAuditLog.record({
    actorId, targetId, action: 'role_changed',
    detail: { oldRole: before.role, newRole: role },
  });
  return updated;
}
```

No existence check precedes any create/update call in this service. A
missing target row throws Prisma's `P2025`; a duplicate username on
create throws `P2002`. Both are already mapped to 404/409 by the
existing global `PrismaExceptionFilter` — the same pattern round-type-
registry's admin CRUD (#588's other controller) already relies on. This
isn't a shortcut so much as staying consistent with an existing
codebase convention: writing a redundant existence check here would add
a second source of truth for "does this row exist" that could drift
from what the actual mutating call finds.

## Key concept: self-service password change needs no permission tier at all

```ts
// AdminAuthController
@Post('change-password')
@UseGuards(AdminJwtAuthGuard)
async changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
  const staff = req.user as AdminSessionPayload;
  await this.adminAuthService.changeOwnPassword(staff.id, dto.currentPassword, dto.newPassword);
  return { status: 'ok' };
}
```

No `PermissionsGuard`, no `@RequirePermission()`. This route only ever
acts on the caller's own account — `staff.id` comes from the session,
never a request parameter — so there's no permission tier to check:
every authenticated role, from `staff` up, can already change their own
password by definition of being an authenticated account. The service
method requires the current password before accepting a new one,
checked *after* the account lookup rather than short-circuiting on a
missing account, so a hijacked-but-still-live session can't be used to
silently lock the real owner out by changing their password without
proving they know it.

## Verification

`test/staff-accounts.e2e-spec.ts` covers the full lifecycle: 401/403
boundaries (unauthenticated, and a `moderator`/`staff` session each
getting 403 on every route), create with a real login using the
returned one-time password, duplicate-username 409, role update,
deactivate blocking login and reactivate restoring it, admin-initiated
reset invalidating the old password while issuing a working new one,
and 404s for a non-existent target. `admin-auth.e2e-spec.ts` gained its
own `POST /auth/admin/change-password` coverage — and immediately hit a
real bug doing it: those tests made five real login calls against the
file's existing *shared* `app` instance, landing on top of the three
attempts earlier tests in the same file already made and tripping
`LoginThrottleService`'s 5-attempts-per-15-minutes IP-keyed limit
partway through two of the new tests. Caught by CI (not locally — e2e
specs can't run against this project's persistent kind-cluster
Postgres), fixed by giving the change-password block its own isolated
`bootApp()` instance, the exact same isolation pattern the file's
existing rate-limit test already used for the identical reason. `npx
tsc --noEmit`, the full unit suite (new coverage for `StaffAccountsService`
and the password-generation utility), and `npm run lint` all clean.
