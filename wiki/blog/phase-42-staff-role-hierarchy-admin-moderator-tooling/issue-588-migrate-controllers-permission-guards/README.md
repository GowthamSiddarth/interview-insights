# Phase 42, Issue #588 — Migrating `ModerationController` and `AdminRoundTypeFieldOptionsController` to Permission-Based Guards

*Part of Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling.
See `docs/ROADMAP.md` Phase 42 and `docs/DECISIONS.md` D99.*

## The gap this closed

#587 built the permission-set infrastructure — the map, the decorator,
the guard — but applied it to nothing. Every route on
`ModerationController` and `AdminRoundTypeFieldOptionsController` still
only required `AdminJwtAuthGuard`: a valid session, any role. This issue
was purely the wiring step — apply `@RequirePermission()` to each
existing route with the right permission from #587's map, add
`PermissionsGuard` alongside `AdminJwtAuthGuard` on both controllers,
and prove a `staff` account is actually blocked from the write routes it
shouldn't have.

## Key concept: read routes get the *_READ permission, everything else gets the tier that already did it

```ts
@UseGuards(AdminJwtAuthGuard, PermissionsGuard)
@Controller('moderation')
export class ModerationController {
  @Get('queue')
  @RequirePermission(PERMISSIONS.MODERATION_QUEUE_READ)
  listPending(...) { ... }

  @Post('queue/:id/approve')
  @RequirePermission(PERMISSIONS.MODERATION_QUEUE_APPROVE)
  approve(...) { ... }
  // ...reject/flag/claim/release, each with its own matching permission
}
```

The mapping itself required no new design decisions — #587's permission
map already encoded which tier gets what. `listPending`/`search` need
only `*_READ` (staff and up); `approve`/`reject`/`flag`/`claim`/
`release` each need the matching moderator-and-up permission, since
those are exactly the actions the single pre-Phase-42 shared credential
used to perform and D99 scoped to `moderator`. Same pattern for
`AdminRoundTypeFieldOptionsController`: listing field options is
`admin:round_types:read` (staff and up, matching D99's explicit mention
of round-type registry as part of `STAFF`'s read scope), create/update
are `admin:round_types:write` (moderator and up — the tier that already
performed this task before this phase existed).

## Key concept: proving the boundary, not just declaring it

```ts
it('lets a staff account read the queue and search, but 403s every moderation action', async () => {
  const staffCookie = (await loginAsStaff(app)).cookie;

  await server().get('/moderation/queue').set('Cookie', staffCookie).expect(200);
  await server().get('/moderation/search').query({ q: 'test' }).set('Cookie', staffCookie).expect(200);

  await server().post(`/moderation/queue/${entry.id}/approve`).set('Cookie', staffCookie).send({}).expect(403);
  // ...reject/flag/claim/release, each asserted 403
});
```

`test/support/admin-session.ts` gained `loginAsStaff` — the first
`staff`-role identity anything in this codebase's test suite needed,
built with the same bypass-the-app-layer, fixed-username-reused pattern
`loginAsSecondModerator` already established in Phase 36. Without this
test, the permission wiring above would be unverified by anything more
than reading the code — a typo in one `@RequirePermission()` call
(wrong permission constant, or a route missed entirely) would ship
silently. This is exactly the kind of regression a unit test can't
catch either: `PermissionsGuard`'s own unit tests (#587) prove the guard
logic works against a mocked role, but nothing short of a real
authenticated HTTP call against the real route wiring proves every route
actually has the decorator it's supposed to.

## Verification

New e2e coverage in both `moderation.e2e-spec.ts` and
`round-type-registry.e2e-spec.ts`: a `staff` account can read but gets
403 on every write/action route, in both controllers. Existing admin/
moderator e2e flows needed no changes at all — both those roles already
carry every permission the routes now require, so the guard addition is
invisible to anyone who was already allowed through. `npx tsc --noEmit`,
the full unit suite, and `npm run lint` all clean; e2e coverage
confirmed green in CI's ephemeral Postgres (never run locally against
this project's persistent kind-cluster database, which the e2e suite
truncates between specs).
