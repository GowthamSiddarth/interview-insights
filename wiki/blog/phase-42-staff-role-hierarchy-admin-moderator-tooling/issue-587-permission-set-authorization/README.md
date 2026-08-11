# Phase 42, Issue #587 — Permission-Set Authorization: `RequirePermission`, `PermissionsGuard`, Role on the Staff JWT

*Part of Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling.
See `docs/ROADMAP.md` Phase 42 and `docs/DECISIONS.md` D99.*

## The gap this closed

#586 gave every staff account a `role` column. Nothing yet read it. This
issue built the actual enforcement mechanism D99 called for: a
permission-set map, a decorator/guard pair to check it per route, and a
JWT session payload that actually carries the caller's role — none of
which existed before this issue, since the pre-Phase-42 system had
exactly one tier and therefore nothing to distinguish.

## Key concept: the permission map is the one place role logic lives

```ts
const STAFF_PERMISSIONS: readonly Permission[] = [
  PERMISSIONS.MODERATION_QUEUE_READ,
  PERMISSIONS.MODERATION_SEARCH_READ,
  PERMISSIONS.MODERATION_ANALYTICS_READ,
  PERMISSIONS.ROUND_TYPES_READ,
];

const MODERATOR_PERMISSIONS: readonly Permission[] = [
  ...STAFF_PERMISSIONS,
  PERMISSIONS.MODERATION_QUEUE_APPROVE,
  PERMISSIONS.MODERATION_QUEUE_REJECT,
  PERMISSIONS.MODERATION_QUEUE_FLAG,
  PERMISSIONS.MODERATION_QUEUE_CLAIM,
  PERMISSIONS.MODERATION_QUEUE_RELEASE,
  PERMISSIONS.ROUND_TYPES_WRITE,
];

const ADMIN_PERMISSIONS: readonly Permission[] = [
  ...MODERATOR_PERMISSIONS,
  PERMISSIONS.STAFF_MANAGE,
];
```

Each tier spreads the one below it, so `admin` is provably a superset of
`moderator`, which is provably a superset of `staff` — a route that
only checks "does this role have permission X" can never accidentally
grant `staff` something `moderator` doesn't have just from a typo, the
way three independent flat `if` checks could. `MODERATION_ANALYTICS_READ`
is defined here even though no route uses it yet — D99's STAFF
description explicitly includes "moderator/SLA analytics dashboards,"
and no such endpoint exists in this codebase today. The permission
exists ahead of its own route, ready for whenever that dashboard gets
built, rather than being invented retroactively at that point.

## Key concept: a decorator that only ever narrows, never grants

```ts
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_METADATA_KEY, permission);

// PermissionsGuard.canActivate
const required = this.reflector.get<Permission | undefined>(
  PERMISSION_METADATA_KEY,
  context.getHandler(),
);
if (!required) return true;

const { role } = req.user as AdminSessionPayload;
if (!roleHasPermission(role, required)) {
  throw new ForbiddenException(`Missing required permission: ${required}`);
}
return true;
```

`PermissionsGuard` reads metadata off `context.getHandler()` — the
specific route method, not the controller class. A route with no
`@RequirePermission()` at all passes through unconditionally: this guard
only ever narrows what `AdminJwtAuthGuard` already granted (a valid
session), it never grants access on its own. That "method, not class"
detail mattered in practice: an early draft of the staff-management
controller (#589) applied `@RequirePermission()` at the class level,
assuming it would cover every route underneath — it silently didn't,
since the guard never checks `context.getClass()`. Caught before it
shipped, fixed by applying the decorator per-route instead, the same
pattern #588 already used for the two existing controllers.

## Key concept: the JWT stops being trusted for anything but identity

```ts
// AdminJwtStrategy.validate()
async validate(payload: AdminSessionPayload): Promise<AdminSessionPayload> {
  const moderator = await this.prisma.moderator.findUnique({ where: { id: payload.id } });
  if (!moderator || !moderator.isActive) {
    throw new UnauthorizedException('Session is no longer valid.');
  }
  return { id: moderator.id, username: moderator.username, role: moderator.role };
}
```

Before this issue, the JWT strategy was purely stateless — it decoded
the token and trusted whatever it said, no database round trip per
request. Adding a `role` claim to the token was the easy part; the
harder question was whether to trust that claim on every subsequent
request, or re-derive it. Trusting it would mean a deactivation or a
role downgrade takes up to the token's full 1-hour expiry to actually
take effect — someone demoted from `admin` to `staff` mid-session would
keep admin permissions until their token expired. The strategy now
re-reads `role`/`isActive` from the database by `id` on every request,
using the JWT purely as a bearer credential for *which* account is
calling, not what that account is currently allowed to do. The cost is
one extra query per authenticated admin/moderator/staff request —
accepted deliberately, since this is a low-traffic internal surface, not
a public hot path where that cost would compound.

## Verification

Unit coverage for the permission map itself (staff excludes every
write permission, moderator is a strict superset of staff without
`admin:staff:manage`, admin is a strict superset of moderator including
it), the guard (allows through with no metadata, allows a role that has
the required permission, throws `ForbiddenException` for one that
doesn't), the decorator (attaches the right metadata, read back via a
real `Reflector` rather than asserting on internal implementation
detail), and the JWT strategy (re-reads from a mocked Prisma call,
rejects a deactivated account even with an otherwise-valid token,
strips `iat`/`exp` same as before). One regression surfaced only in
CI, not locally: `GET /auth/admin/me`'s existing e2e test asserted the
exact response shape via `toEqual({id, username})` — adding `role` to
the payload broke that strict equality. E2e specs in this project can't
be run locally against the persistent kind-cluster Postgres (they
truncate tables), so this only showed up once pushed; fixed in a
follow-up commit on the same branch before merge. `npx tsc --noEmit`,
the full unit suite, and `npm run lint` all clean.
