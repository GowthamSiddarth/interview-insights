-- GitHub issue #687 (Phase 49, D104) — confirmed bug fix: a candidate
-- editing a rejected/flagged entity gets re-enqueued (reenqueue()) into
-- a fresh moderation_queue row for the same entity_id, but the old
-- idempotency key (entity_type + entity_id + event_type alone) treated
-- any status_changed event on that entity_id as "already notified" —
-- so a candidate was never notified of any review decision after the
-- first one on a given entity. Default empty string keeps prior dedup
-- behavior unchanged for event types that don't carry a real
-- moderation_queue_entry_id (created/sla_breach — see
-- notification-consumer.service.ts's moderationQueueEntryIdFor()).
--
-- Hand-authored and applied via `prisma migrate deploy` rather than
-- `migrate dev` — `migrate dev`'s shadow-database replay fails against
-- this schema (D64, same pre-existing workaround #485/#486/#679 already
-- use).

-- DropIndex
DROP INDEX "notification_log_entity_type_entity_id_event_type_key";

-- AlterTable
ALTER TABLE "notification_log" ADD COLUMN "moderation_queue_entry_id" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "notification_log_dedup_key" ON "notification_log"("entity_type", "entity_id", "event_type", "moderation_queue_entry_id");
