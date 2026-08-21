# Phase 54, Issue #798 — candidates.verification_status.document_verified Is a Dead Enum Value

*Part of Phase 54 — Business-Process Closed-Loop Fixes.
See `docs/ROADMAP.md` Phase 54.*

## The gap

`VerificationStatus` had three values —
`unverified`/`email_verified`/`document_verified` — but no code
anywhere in the repo ever writes `document_verified`. There's no
document-upload flow, no review step, nothing that could ever transition
a candidate into that state. It was schema-ready for a feature that was
never built, sitting in the enum as a permanently unreachable value —
not a bug exactly, but dead surface area that makes the schema look
like it supports something it doesn't.

## The fix: a real migration, not just leaving it alone

Postgres has no `ALTER TYPE ... DROP VALUE` — removing an enum member
means the standard create-new-type, swap-the-column-over, drop-the-old-type
dance:

```sql
-- Safe against live data: nothing in this codebase ever writes
-- 'document_verified', so no row can hold it.
CREATE TYPE "VerificationStatus_new" AS ENUM ('unverified', 'email_verified');

ALTER TABLE "candidates"
    ALTER COLUMN "verification_status" DROP DEFAULT,
    ALTER COLUMN "verification_status" TYPE "VerificationStatus_new"
        USING ("verification_status"::text::"VerificationStatus_new"),
    ALTER COLUMN "verification_status" SET DEFAULT 'unverified';

DROP TYPE "VerificationStatus";
ALTER TYPE "VerificationStatus_new" RENAME TO "VerificationStatus";
```

The `USING` clause's cast is what makes this safe to run against a live
table: every existing row's `verification_status` value gets
reinterpreted against the new, narrower type, and since no row can
possibly hold `document_verified` (nothing ever wrote it), that cast
can never fail. `schema.prisma`'s own `VerificationStatus` enum shrinks
to match in the same change, keeping the migration and the schema
declaration honest with each other.

## Verification

Applied directly against a real local Postgres instance
(`npx prisma migrate deploy`) rather than trusted on the strength of the
SQL alone — migrations are the one class of change in this project where
"it looks correct" isn't sufficient, since a bad `ALTER TYPE` against
live data is exactly the kind of mistake that's expensive to undo later.
Confirmed the column's type and default survived the swap intact and
every existing `unverified`/`email_verified` row round-tripped
unchanged.
