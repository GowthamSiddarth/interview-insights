# Phase 28, Issue #284 — Adding "Tech Screening" as a Round Type

*Part of Phase 28 — Wizard UX Refinements. See `docs/ROADMAP.md` Phase 28
and epic #280.*

## Why an enum value needs two migrations, not one

Adding `tech_screening` to the `RoundType` Postgres enum looks like a
one-line change (`ALTER TYPE "RoundType" ADD VALUE 'tech_screening'`),
and `prisma migrate dev` happily generates exactly that. The wrinkle is
what comes next: this project also wanted to seed
`round_type_field_options` rows for the new type's controlled-vocabulary
fields, in the same style every other structured round type already
has. Postgres won't let a newly added enum value be *used* — including
in an `INSERT` — within the same transaction that added it. Since each
Prisma migration file runs as its own transaction, the fix is
mechanical: one migration adds the enum value (and is applied,
committing it), a second migration seeds the option rows afterward.
Nothing about this needed to be discovered live — it's a documented
Postgres restriction — but it's the kind of detail that's easy to miss
until `prisma migrate dev` throws a genuinely confusing error on the
seed insert.

## Key concept: the registry made this a config change, not a code change

Phase 24 issue #248 built the round-type registry specifically so that
a round type's `type_metadata` shape lives in one static config object
(`api/src/round-type-registry/round-type-field-schema.ts`), with
controlled-vocabulary values sourced from the admin-manageable
`round_type_field_options` table rather than hardcoded. Adding
`tech_screening` here is a genuine test of that design: two new field
definitions —

```ts
tech_screening: [
  { key: 'screeningFormat', kind: 'controlled-single' },
  { key: 'topicsCovered', kind: 'controlled-multi' },
],
```

— plus seeded default values, and the entire validation pipeline
(`RoundTypeFieldOptionsService.validateTypeMetadata()`) and the entire
frontend renderer (`TypeMetadataFields`, built registry-driven in issue
#254) needed zero other changes to support it correctly.

## What this enabled

A candidate can now log a lightweight initial screening call as its
own distinct round type, with its own sensible fields (format, topics
covered) instead of awkwardly reusing `assessment` or `other`. And the
fact that this took exactly one config addition plus two migrations —
no frontend conditional, no new validation branch — is the actual
payoff of building the registry in Phase 24 rather than hardcoding
round types throughout the codebase.
