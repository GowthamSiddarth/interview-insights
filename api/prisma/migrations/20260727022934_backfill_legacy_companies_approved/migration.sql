-- GitHub issue #369 (Phase 35) introduced Company.status (migration
-- 20260726040323_add_company_moderation_status) as a NOT NULL column with
-- DEFAULT 'pending'. Postgres backfills that default onto every
-- *pre-existing* row when a NOT NULL column is added this way — every
-- company created before that migration ran was silently flipped to
-- 'pending', hiding it from every public read path (list, by-slug,
-- reviews, analytics, search) and blocking new process creation against
-- it, even though it had been fully public and in active use for a long
-- time. A real live bug report ("Record not found" clicking "Write a
-- review" for Amazon) surfaced this.
--
-- Fix: mark every company created strictly before that migration's own
-- started_at as approved — it was already public and never actually
-- pending review in the first place. Anything created at or after that
-- timestamp goes through the real moderation flow as designed and is
-- left untouched here.
UPDATE "companies"
SET "status" = 'approved'
WHERE "status" = 'pending'
  AND "created_at" < (
    SELECT "started_at"
    FROM "_prisma_migrations"
    WHERE "migration_name" = '20260726040323_add_company_moderation_status'
  );
