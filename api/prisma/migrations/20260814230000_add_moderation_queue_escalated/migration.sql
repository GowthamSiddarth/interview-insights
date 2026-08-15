-- GitHub issue #689 (Phase 49, D104) — lifetime resubmission cap:
-- reenqueue() sets this once a resubmission crosses the cap (default 3
-- prior submissions). Gates human resolution to admin-only
-- (EscalatedEntryGuard) and skips AI auto-approval entirely.
--
-- Hand-authored and applied via `prisma migrate deploy` rather than
-- `migrate dev` — `migrate dev`'s shadow-database replay fails against
-- this schema (D64, same pre-existing workaround #485/#486/#679 already
-- use).

-- AlterTable
ALTER TABLE "moderation_queue" ADD COLUMN "escalated" BOOLEAN NOT NULL DEFAULT false;
