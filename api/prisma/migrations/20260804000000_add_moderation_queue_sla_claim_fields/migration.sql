-- GitHub issue #486 (Phase 36, D80) — SLA deadline + manual-claim fields
-- on moderation_queue. sla_deadline backfills from each row's own
-- created_at (not migration-run time), so already-queued entries get a
-- deadline consistent with when they actually entered the queue rather
-- than one inflated by however long they've already been pending. The
-- column keeps a DB-level default of created_at-style now()+48h purely as
-- a safety net for any insert path that forgets to set it explicitly —
-- ModerationService.enqueue()/reenqueue() always pass the real,
-- configurable-hours value themselves (MODERATION_SLA_HOURS, default 48).
--
-- Hand-authored and applied via `prisma migrate deploy` rather than
-- `migrate dev`, matching #485's migration note (`migrate dev`'s
-- shadow-database replay fails against this schema, D64).

-- AlterTable
ALTER TABLE "moderation_queue" ADD COLUMN "sla_deadline" TIMESTAMPTZ;

UPDATE "moderation_queue" SET "sla_deadline" = "created_at" + INTERVAL '48 hours' WHERE "sla_deadline" IS NULL;

ALTER TABLE "moderation_queue" ALTER COLUMN "sla_deadline" SET NOT NULL;
ALTER TABLE "moderation_queue" ALTER COLUMN "sla_deadline" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '48 hours');

ALTER TABLE "moderation_queue" ADD COLUMN "claimed_by" UUID;
ALTER TABLE "moderation_queue" ADD COLUMN "claimed_at" TIMESTAMPTZ;

-- AddForeignKey
ALTER TABLE "moderation_queue" ADD CONSTRAINT "moderation_queue_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "moderators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
