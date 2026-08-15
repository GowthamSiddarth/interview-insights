# Phase 50, Issue #696 — `candidateId` FK on `Company` + Partial Unique Index on `slug`

*Part of Phase 50 — Company Creation Request Lifecycle.
See `docs/ROADMAP.md` Phase 50, D104.*

## The gap

The same notification/communication-chain audit that produced Phase 49
(D104) found two related problems in `Company`: a rejected
company-creation request permanently occupied its `slug` (a plain
`@unique` column) with no recovery path —
`CompaniesService.create()`'s own comment flagged this as "unresolved" —
and nothing recorded *who* had requested a company at all, so there was
no way to attribute an edit endpoint (#697) or a notification (#698) to
the right candidate.

## The fix, part one: a partial unique index instead of a plain one

The natural fix for the slug problem is a Postgres partial (filtered)
unique index — `CREATE UNIQUE INDEX ... ON companies(slug) WHERE status
IN ('pending', 'approved')` — but Prisma's schema DSL (as of the version
this project runs, 6.19.3) has no way to express a `WHERE` clause on
`@@unique`/`@@index`. The fix (documented as D107): drop `@unique` from
`Company.slug` in `schema.prisma` entirely, with an explanatory comment,
and create the real constraint only in the hand-authored `migration.sql`
— the same "raw SQL is the source of truth for whatever Prisma's
migration engine can't express" precedent this project already used for
`pg_trgm` similarity queries (D64).

```sql
DROP INDEX "companies_slug_key";

CREATE UNIQUE INDEX "companies_slug_pending_approved_key"
    ON "companies" ("slug")
    WHERE "status" IN ('pending', 'approved');
```

The practical cost: `prisma.company.findUnique({ where: { slug } })` no
longer type-checks (`findUnique` only accepts `@unique`/`@id` fields).
`CompaniesService.create()`'s pending-duplicate pre-check moved to
`findFirst({ where: { slug, status: 'pending' } })` — an *approved*
duplicate still falls through to the real constraint's generic 409,
unchanged from before; only a *rejected* duplicate now succeeds.

## The fix, part two: `candidateId`, with a deliberate `ON DELETE` deviation

```prisma
candidateId String? @map("candidate_id") @db.Uuid
candidate   Candidate? @relation(fields: [candidateId], references: [id], onDelete: SetNull)
```

Nullable (a seed/admin-created company has no requester), attributed via
the existing `CurrentCandidateId` session-derived decorator (#146) —
same pattern every other write path in this app already uses. The one
deliberate deviation from convention: every other candidate-owned FK in
this schema is `ON DELETE RESTRICT`, since `RoundRating`/etc. are the
candidate's *own* content and get hard-deleted alongside them during
GDPR erasure (`me.service.ts`). A `Company` is different — it's shared
platform data other candidates' `InterviewProcess` rows may already
reference — so `RESTRICT` would have made erasing the requesting
candidate impossible once they'd ever requested one, and `CASCADE` would
have deleted a company other people depend on. `SET NULL` anonymizes the
reference instead: the row survives, the requester attribution doesn't.

## Verification

New e2e case in `company-moderation.e2e-spec.ts`: two *rejected*
company requests share the same slug end to end, against a real
partial index (the pending/approved 409 cases were already covered and
pass unchanged). `gdpr-erasure.e2e-spec.ts` was extended to prove the
`ON DELETE SET NULL` behavior directly rather than just asserting it in
a comment — the erased candidate's own company request survives with
`candidateId: null`. `companies.service.spec.ts`'s `create` tests were
rewritten around the `findFirst()`-based check.
