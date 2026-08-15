-- GitHub issue #704 (Phase 51, D104) — tracks whether the new
-- 75%-elapsed-still-unclaimed SLA warning tier has already broadcast for
-- this entry, same pattern breach_notified_at already established.
ALTER TABLE "moderation_queue" ADD COLUMN "warning_notified_at" TIMESTAMPTZ;
