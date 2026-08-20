-- GitHub issue #798 (Phase 54) — 'document_verified' was schema-ready
-- but structurally unreachable: no document-upload/review flow exists
-- anywhere in this codebase, and code only ever writes
-- unverified -> email_verified. Dropping the dead value rather than
-- leaving a permanently unreachable enum member. Postgres has no
-- ALTER TYPE ... DROP VALUE, so this is the standard create-new-type,
-- swap-the-column-over, drop-the-old-type pattern. Safe against live
-- data: nothing in this codebase ever writes 'document_verified', so no
-- row can hold it.
CREATE TYPE "VerificationStatus_new" AS ENUM ('unverified', 'email_verified');

ALTER TABLE "candidates"
    ALTER COLUMN "verification_status" DROP DEFAULT,
    ALTER COLUMN "verification_status" TYPE "VerificationStatus_new"
        USING ("verification_status"::text::"VerificationStatus_new"),
    ALTER COLUMN "verification_status" SET DEFAULT 'unverified';

DROP TYPE "VerificationStatus";
ALTER TYPE "VerificationStatus_new" RENAME TO "VerificationStatus";
