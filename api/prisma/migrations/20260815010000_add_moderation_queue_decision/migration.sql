-- GitHub issue #691 (Phase 49, D104) — records the actual verdict reached
-- on a moderation_queue row (distinct from the entity's own status, which
-- resets to pending on resubmission), so ModerationService can surface an
-- accurate "prior submissions" trail in the moderator queue UI. Reuses the
-- existing "ModerationStatus" enum type — same pattern the schema comment
-- next to this column documents.
ALTER TABLE "moderation_queue" ADD COLUMN "decision" "ModerationStatus";
