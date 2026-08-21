# Phase 52, Issue #781 — Raw SQL Identifier Interpolation in Fraud Checks

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52.*

## The gap

`FraudChecksService.checkDuplicateFreeText()` (D64) runs a `pg_trgm`
trigram similarity query against whichever table matches the entity
type being checked (`round_ratings`, `recruiter_ratings`,
`overall_reviews`). The old implementation picked the table/column names
from a fixed internal map and interpolated them into the raw SQL string
via `Prisma.raw()`:

```ts
// before
const { table, column } = TABLE_COLUMN_MAP[entityType];
await this.prisma.$queryRaw`
  SELECT EXISTS (
    SELECT 1 FROM ${Prisma.raw(`"${table}"`)}
    WHERE ${Prisma.raw(`"${column}"`)} IS NOT NULL
      AND similarity(lower(${Prisma.raw(`"${column}"`)}), ${normalizedFreeText}) > ${threshold}
  ) AS "found"
`;
```

Every actual input here came from a fixed, internal map — `entityType`
is a validated Prisma enum, never client-controlled free text — so this
was never exploitable *today*. The audit flagged it anyway: the
*pattern* is injection-shaped. `Prisma.raw()` interpolating a table or
column name is safe only for as long as every caller's input is
provably fixed and internal — the pattern itself is a landmine for a
future change that widens what feeds it, with nothing in the code
itself to stop that.

## The fix: a literal query per type, no identifier interpolation at all

Replaced the single parameterized-by-map query with a `switch` over the
three real entity types, each a hardcoded literal query string — table
and column names are never constructed from a variable, anywhere:

```ts
private async hasSimilarExistingText(
  tx: PrismaTransaction,
  entityType: Exclude<ModerationEntityType, 'company'>,
  normalizedFreeText: string,
): Promise<boolean> {
  switch (entityType) {
    case 'round_rating': {
      const rows = await tx.$queryRaw<{ found: boolean }[]>(Prisma.sql`
        SELECT EXISTS (
          SELECT 1 FROM "round_ratings"
          WHERE "free_text" IS NOT NULL
            AND similarity(lower("free_text"), ${normalizedFreeText}) > ${DUPLICATE_SIMILARITY_THRESHOLD}
        ) AS "found"
      `);
      return rows[0]?.found ?? false;
    }
    case 'recruiter_rating': { /* same shape, "recruiter_ratings" */ }
    case 'overall_review': { /* same shape, "overall_reviews" */ }
  }
}
```

`normalizedFreeText`/`DUPLICATE_SIMILARITY_THRESHOLD` are still
interpolated — that's the safe, intended use of `Prisma.sql`'s
tagged-template parameterization (values, not identifiers). What's gone
is any code path where a variable ever becomes part of the SQL text
itself. This exact literal-`switch`-per-type shape became the template
for two later fixes in this same audit batch that needed their own raw
SQL — #824 (Phase 57)'s Postgres-side review pagination reused the
identical "only values are parameterized, never identifiers" reasoning.

## Verification

`fraud-checks.service.spec.ts` already asserted the query's `.sql`/
`.values` shape per entity type via a `lastQuery()` helper reading
straight off the mocked `$queryRaw` call — those assertions needed no
changes, since the externally observable query shape (which table, which
column, what gets parameterized) is identical before and after; only how
the SQL string gets built internally changed. The real regression risk
here was a copy-paste table/column mismatch across three near-identical
`case` blocks, which the existing per-type test coverage would have
caught immediately.
