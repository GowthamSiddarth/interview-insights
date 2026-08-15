-- GitHub issue #688 (Phase 49, D104) — a moderator's own stated
-- rejection reason + free-text note, distinct from moderation_queue's
-- existing flag_reason (a system/pre-write signal). Surfaced back to
-- the candidate and, alongside prior-submission history, to the
-- moderator queue UI (#691).
--
-- Hand-authored and applied via `prisma migrate deploy` rather than
-- `migrate dev` — `migrate dev`'s shadow-database replay fails against
-- this schema (D64, same pre-existing workaround #485/#486/#679 already
-- use).

-- CreateEnum
CREATE TYPE "ModerationRejectionReason" AS ENUM ('low_quality', 'guideline_violation', 'identifying_information', 'spam_or_promotional', 'inaccurate_or_unverifiable', 'other');

-- AlterTable
ALTER TABLE "moderation_queue" ADD COLUMN "rejection_reason_category" "ModerationRejectionReason";
ALTER TABLE "moderation_queue" ADD COLUMN "review_note" TEXT;
