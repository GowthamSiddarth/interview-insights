# Phase 27, Issue #263 — Admin CRUD API for `round_type_field_options`

*Part of Phase 27 — Admin Content Gateway (Round-Type Field Options).
See `docs/ROADMAP.md` Phase 27 and `docs/DECISIONS.md` D47.*

## The gap this closed

Phase 24 issue #248 built the round-type registry's read side: a
public `GET /round-types/field-options`, service-layer validation
against `round_type_field_options`, and seeded illustrative defaults
for every controlled field across all 8 round types (a 9th,
`tech_screening`, was added in Phase 28). What #248 explicitly left
for later: any way to actually *manage* those values other than a raw
SQL migration. This issue builds that write side — add, update, and
retire controlled-vocabulary values through a real admin API.

## Key concept: a new controller, not a shared one

The existing `RoundTypeRegistryController` serves the public endpoint
and has no guard at all — every visitor's wizard needs to read it to
render round-creation fields. The new admin routes need
`AdminJwtAuthGuard`. Rather than add guarded routes to an otherwise-
public controller (which would require per-route guard annotations and
make the class's overall access model harder to read at a glance), the
admin routes got their own `AdminRoundTypeFieldOptionsController`
(`admin/round-types/...`), gated at the class level — the same
separation `ModerationController` already models for its own
admin-only surface.

## Key concept: reuse the existing 404/409 mapping instead of duplicating it

`round_type_field_options` has a real unique constraint —
`@@unique([roundType, fieldKey, value])`. A naive implementation might
manually check for an existing row before inserting, or manually
catch a duplicate-key error. Neither was necessary: this project's
global `PrismaExceptionFilter` already maps Prisma's `P2002` (unique
violation) to a 409 and `P2025` (record not found, e.g. updating a
non-existent id) to a 404. `createOption()`/`updateOption()` just call
Prisma directly and let the filter do its job — the same pattern every
other write path in this codebase already follows.

```ts
async createOption(roundType: RoundType, dto: CreateRoundTypeFieldOptionDto) {
  this.assertControlledField(roundType, dto.fieldKey);
  // ...compute sortOrder...
  // A duplicate (roundType, fieldKey, value) surfaces as a 409 via the
  // global PrismaExceptionFilter (P2002) — no app-level check needed.
  return this.prisma.roundTypeFieldOption.create({
    data: { roundType, fieldKey: dto.fieldKey, value: dto.value, sortOrder },
  });
}
```

## Key concept: retiring is never a delete

D47 already established this for the seed data: retiring a value flips
`isActive` to `false` rather than deleting the row, because a round's
historical `type_metadata` might still reference a value that's no
longer offered to new submissions. `updateOption()` is a plain field
update — `isActive`, `value`, and `sortOrder` can all change
independently, but the row itself is never removed by this API. There
is deliberately no `DELETE` route at all.

## Key concept: `fieldKey` validation reuses the existing registry check

A new `assertControlledField()` helper rejects two cases before any
database write happens: an unknown `fieldKey` for that round type, and
a `fieldKey` that exists but is a `text` field (which has no
admin-managed vocabulary by definition — it's free-form input). This
mirrors the exact reasoning `validateTypeMetadata()` already uses when
a candidate submits a round's `type_metadata` — the registry
(`ROUND_TYPE_FIELD_SCHEMA`) stays the single source of truth for which
fields exist and what kind they are, whether the caller is a candidate
submitting a round or an admin managing its options.

## Step-by-step: what actually got built and verified

1. Two new DTOs (`CreateRoundTypeFieldOptionDto`,
   `UpdateRoundTypeFieldOptionDto`) with straightforward `class-
   validator` decorators.
2. `RoundTypeFieldOptionsService` gained `listAllOptions()` (every row
   for a round type, active and inactive), `createOption()` (defaults
   `sortOrder` to one past the current highest for that field when
   omitted), and `updateOption()`.
3. `AdminRoundTypeFieldOptionsController`: `GET`/`POST
   .../:roundType/field-options`, `PATCH .../field-options/:id`, all
   behind `AdminJwtAuthGuard`.
4. 21 new/updated unit tests (301 → 308 api unit tests total) + 7 new
   e2e tests against real Postgres proving: unauthenticated 401 on
   every route; a new value appears immediately in both the admin list
   and the public endpoint; an unknown or free-text `fieldKey` is
   rejected (400); a duplicate value 409s; retiring removes a value
   from the public endpoint while the row stays visible (and
   `isActive: false`) in the admin list; a non-existent id 404s.
5. Live-verified against the real `kind` cluster via curl: added a
   real `problemAlgorithms` value, confirmed it appeared in the public
   endpoint, retired it, confirmed it disappeared from public while
   staying in the admin list.

## What this enabled

Issue #264's admin UI page had a real API to build against — every
interaction it needed (list, add, edit, retire) already existed,
tested, and live-verified before any frontend code was written.
