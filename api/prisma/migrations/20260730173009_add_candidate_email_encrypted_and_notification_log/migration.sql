-- GitHub issue #335 (Phase 31, D74) — Candidate.emailEncrypted is a
-- deliberate, narrow exception to "never store raw email"
-- (docs/DATA_MODEL.md design principle 1): notification-service needs an
-- actual address to send "your submission is pending review" to, and
-- Candidate.emailHash (an HMAC) can never be reversed back into one.
-- Nullable — rows written before this column existed have no raw email
-- to backfill.
ALTER TABLE "candidates" ADD COLUMN     "email_encrypted" TEXT;

-- notification_log: idempotent-consumption tracking for
-- notification-service (see schema.prisma's own comment on this model
-- for why entity_type/event_type are plain text, not the
-- ModerationEntityType enum). Written/read exclusively by
-- notification-service; this migration is the source of truth for its
-- shape per CLAUDE.md hard constraint #5, same as every other table here.
-- CreateTable
CREATE TABLE "notification_log" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- The idempotency key itself: a redelivered event's INSERT hits this
-- constraint and is skipped rather than sending a second email.
-- CreateIndex
CREATE UNIQUE INDEX "notification_log_entity_type_entity_id_event_type_key" ON "notification_log"("entity_type", "entity_id", "event_type");
