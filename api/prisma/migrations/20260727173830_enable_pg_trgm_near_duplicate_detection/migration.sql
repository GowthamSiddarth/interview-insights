-- GitHub issue #162 (Phase 19) — replaces D13's exact-match-only,
-- application-code full-table-scan duplicate detection with Postgres
-- trigram similarity, computed in the database. Not modeled in
-- schema.prisma (Prisma has no first-class representation of extensions
-- or GIN/trgm indexes without the postgresqlExtensions preview feature),
-- same "raw SQL for what Prisma can't express" pattern already used for
-- the Phase 1 CHECK constraints and the Phase 4 materialized views.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Expression indexes on lower(...) so they actually back the
-- `similarity(lower(column), lower($1))` query FraudChecksService runs —
-- a plain gin_trgm_ops index on the raw column wouldn't be usable by an
-- expression-wrapped comparison. Partial (WHERE ... IS NOT NULL) since a
-- null free-text/review-text row is never a candidate for comparison.
CREATE INDEX "round_ratings_free_text_trgm_idx"
  ON "round_ratings" USING GIN (lower("free_text") gin_trgm_ops)
  WHERE "free_text" IS NOT NULL;

CREATE INDEX "recruiter_ratings_free_text_trgm_idx"
  ON "recruiter_ratings" USING GIN (lower("free_text") gin_trgm_ops)
  WHERE "free_text" IS NOT NULL;

CREATE INDEX "overall_reviews_review_text_trgm_idx"
  ON "overall_reviews" USING GIN (lower("review_text") gin_trgm_ops)
  WHERE "review_text" IS NOT NULL;
