-- GitHub issue #488 (Phase 36, D80) — SLA breach detection idempotency.
-- breach_notified_at is set the first time SlaBreachDetectionService's
-- sweep (@Cron, in-process — see D72's identical precedent for the
-- reconciliation sweep) publishes a moderation.queue.sla_breach.v1 event
-- for a given entry, so a still-breached entry is never re-notified on
-- every later sweep tick. Nullable, no default — most entries are never
-- breached at all.
--
-- Hand-authored and applied via `prisma migrate deploy` rather than
-- `migrate dev`, matching #485/#486's migration note (`migrate dev`'s
-- shadow-database replay fails against this schema).

-- AlterTable
ALTER TABLE "moderation_queue" ADD COLUMN "breach_notified_at" TIMESTAMPTZ;
