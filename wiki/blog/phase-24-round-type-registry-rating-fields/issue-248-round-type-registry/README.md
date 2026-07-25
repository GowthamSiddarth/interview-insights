# Phase 24, Issue #248 — Round-Type Registry, Expanded to All 8 Round Types

*Part of Phase 24 — Round-Type Registry & Rating Field Redesign. See
`docs/ROADMAP.md` Phase 24 and `docs/DECISIONS.md` D47.*

## Why the scope changed before a line of code was written

Issue #248 was originally filed covering exactly two round types —
`coding` and `system_design` — with every other round type staying
free-form JSON indefinitely, and any controlled-vocabulary values
(specific algorithm names, specific data structures) hardcoded wherever
they were needed. Before implementation started, the project owner
expanded this directly: all 8 `RoundType` values should get structured
schemas, and — the more consequential change — the *values* behind
controlled-vocabulary fields needed to be admin-manageable through a
UI, not hardcoded in application code. That second part meant this
issue could no longer just be "add two schemas"; it had to introduce a
real data model for admin-controlled option lists, and a brand-new
phase (Phase 27) had to be planned to eventually manage them.

This is the same "resolve the real design questions before writing
code" discipline this project has used since Phase 16 — three
AskUserQuestion rounds settled it: cover all 8 round types (including
proposing reasonable fields for `assessment`/`take_home`/`other`,
which the user hadn't given examples for); keep this issue
backend-only, since the current wizard is fully replaced by Phase
26 shortly after; and place the new admin-gateway phase after Phase
25/26 in the implementation order, since nothing downstream is
actually blocked on it existing yet.

## Key concept: a registry is a config object, not a database

The round-type → field-schema mapping itself is a static TypeScript
config (`api/src/round-type-registry/round-type-field-schema.ts`), not a
database table. Every field is either `text` (free-form string, no
admin-managed vocabulary) or `controlled-single`/`controlled-multi`
(constrained to a fixed set of values). This is the single place that
answers "what fields does a `leadership` round have, and what kind is
each one" — no scattered per-round-type conditionals anywhere else in
the codebase.

`other` deliberately gets no controlled field at all — just a free-text
`notes` key. It's the catch-all round type by definition; inventing a
fixed vocabulary for an intentionally-unclassified category would defeat
the point of having an escape hatch.

## Key concept: read now, write later — splitting the phase in two

The controlled-vocabulary *values* (which algorithms, which leadership
principles) live in a new `round_type_field_options` table — one row
per selectable value, with an `isActive` flag rather than a hard delete
so retiring a value never invalidates historical `type_metadata` that
already reference it. This issue builds only the **read side**: the
registry, semantic validation, a public `GET /round-types/field-options`
endpoint, and a migration that seeds illustrative defaults for every
controlled field across the 7 structured round types. The **write
side** — an admin CRUD API and UI to actually manage those values — is
Phase 27, filed alongside this issue but sequenced to be implemented
after Phase 25/26, since this issue's seeded defaults are enough for
those two phases to build against.

## Key concept: validation belongs in the service, not an async DTO validator

`CreateRoundDto.typeMetadata` keeps its existing `@IsObject()` shape-only
check. The real question — does this round type accept this key, and is
this controlled value currently active — is answered in
`RoundsService.create()`, which calls
`RoundTypeFieldOptionsService.validateTypeMetadata()` before writing.
This matches how this codebase already handles business-rule validation
elsewhere (`FraudChecksService`, `ModerationService`) rather than
building a custom async `class-validator` constraint with its own DI
wiring.

## System design approach

```
api/src/round-type-registry/
  round-type-field-schema.ts       # static config: round type -> field defs
  round-type-field-options.service.ts  # getActiveOptions / getFullSchemaWithOptions / validateTypeMetadata
  round-type-registry.controller.ts    # GET /round-types/field-options (public)
  round-type-registry.module.ts
```

`RoundsModule` imports `RoundTypeRegistryModule` so `RoundsService` can
inject `RoundTypeFieldOptionsService` and validate before every write.
The new `round_type_field_options` table:

```prisma
model RoundTypeFieldOption {
  id        String    @id @default(uuid()) @db.Uuid
  roundType RoundType @map("round_type")
  fieldKey  String    @map("field_key")
  value     String
  sortOrder Int       @default(0) @map("sort_order")
  isActive  Boolean   @default(true) @map("is_active")
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([roundType, fieldKey, value])
  @@index([roundType, fieldKey, isActive])
  @@map("round_type_field_options")
}
```

## Step-by-step: what actually got built and verified

1. **Migration**: the new table, plus a raw-SQL seed of illustrative
   defaults (algorithms, data structures, system-design concepts,
   behavioral frameworks, a generic leadership-principles list
   deliberately not attributed to any one company, case-study
   frameworks, assessment formats, take-home project types) across the
   7 structured round types.
2. **The registry module** — static schema, the options service, the
   public read endpoint.
3. **`RoundsService.create()`** wired to validate before writing;
   unknown keys or inactive/unknown controlled values reject with a
   400.
4. **16 new unit tests** (valid/invalid shapes per round type,
   inactive-value rejection, unknown-key rejection, `other`'s
   notes-only case, `RoundsService`'s rejection path) + **6 new e2e
   tests** (the endpoint's shape, a real coding/leadership round
   round-trip, rejection cases).
5. **Docs**: `docs/DATA_MODEL.md`'s `type_metadata` examples replaced
   with the full 8-round-type registry table; `docs/ROADMAP.md`/
   `docs/DECISIONS.md` (D47) updated; **Phase 27 filed** (milestone,
   epic #262, three sub-issues — admin CRUD API, admin UI page,
   engineering blog) as planning-only, no implementation yet.
6. **Live-verified** via curl against the real dev Postgres: the new
   endpoint returning all 8 round types with seeded option values, a
   valid coding round round-tripping with real `problemAlgorithms`/
   `problemDataStructures` values, and an invalid algorithm value
   correctly rejected with a 400 — test data cleaned up afterward.

## What this enabled

Every round type now has a real, validated shape instead of an
unvalidated JSON blob — and the values behind the controlled fields are
already structured to be admin-editable the moment Phase 27 builds the
management UI, without needing another migration to get there. Phase
26's wizard rewrite (issue #254) inherits a stable, already-built
registry to consume rather than needing to invent one under the
pressure of also rewriting the wizard's entire navigation model.
