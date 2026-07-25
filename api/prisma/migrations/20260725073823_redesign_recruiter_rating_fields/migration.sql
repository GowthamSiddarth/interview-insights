-- GitHub issue #249: redesign recruiter_ratings fields (kickoff brainstorm
-- resolved before implementation, see docs/DECISIONS.md D48).
--
-- approachability -> reachability is a true rename (data-preserving),
-- reinterpreting the field's meaning from "were they friendly" to "could
-- you actually get hold of them when needed".
--
-- response_time + timeliness merge into one responsiveness field —
-- candidates can't cleanly separate "replied fast" from "kept to promised
-- dates" in one rating anyway. Only one column can survive a rename;
-- response_time's data is kept (renamed to responsiveness), timeliness is
-- dropped outright, same as issue #247 dropped fairness/bias_signal.
--
-- communication_quality is dropped entirely — its signal folds into
-- reachability/responsiveness/free_text, matching this issue's own
-- 4-field target.
--
-- guidelines_shared and rejection_message_authenticity are genuinely new
-- columns, no data to migrate. rejection_message_authenticity is nullable
-- by design (D48) — a touchpoint only has an opinion on this when it was
-- actually about a rejection.

-- The materialized view depends on the columns being renamed/dropped below
-- (Postgres won't let you touch a column a view depends on) — drop it
-- first, recreate at the end with the new column set.
DROP MATERIALIZED VIEW IF EXISTS "company_recruiter_aggregates";

ALTER TABLE "recruiter_ratings" RENAME COLUMN "approachability" TO "reachability";
ALTER TABLE "recruiter_ratings" RENAME COLUMN "response_time" TO "responsiveness";

ALTER TABLE "recruiter_ratings" DROP COLUMN "timeliness";
ALTER TABLE "recruiter_ratings" DROP COLUMN "communication_quality";

ALTER TABLE "recruiter_ratings" ADD COLUMN "guidelines_shared" SMALLINT NOT NULL;
ALTER TABLE "recruiter_ratings" ADD COLUMN "rejection_message_authenticity" SMALLINT;

-- The renamed columns keep their existing CHECK constraints under their old
-- names (Postgres doesn't auto-rename constraint names on RENAME COLUMN) —
-- drop and recreate under names that match the new columns. The dropped
-- columns' constraints go with them implicitly, but drop explicitly too so
-- this migration is self-documenting.
ALTER TABLE "recruiter_ratings" DROP CONSTRAINT IF EXISTS "recruiter_ratings_approachability_check";
ALTER TABLE "recruiter_ratings" DROP CONSTRAINT IF EXISTS "recruiter_ratings_response_time_check";
ALTER TABLE "recruiter_ratings" DROP CONSTRAINT IF EXISTS "recruiter_ratings_timeliness_check";
ALTER TABLE "recruiter_ratings" DROP CONSTRAINT IF EXISTS "recruiter_ratings_communication_quality_check";

ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_reachability_check" CHECK ("reachability" BETWEEN 1 AND 5);
ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_responsiveness_check" CHECK ("responsiveness" BETWEEN 1 AND 5);
ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_guidelines_shared_check" CHECK ("guidelines_shared" BETWEEN 1 AND 5);
ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_rejection_message_authenticity_check" CHECK ("rejection_message_authenticity" IS NULL OR "rejection_message_authenticity" BETWEEN 1 AND 5);

-- Recreate the view (not Prisma-managed, see schema.prisma's own comment)
-- with the new column set. rejection_message_authenticity is deliberately
-- excluded here, same precedent round_ratings.technical_depth already set
-- (nullable/optional fields stay out of the shrinkage-scored aggregation
-- layer — only in raw per-rating reads via MeService/ModerationService).
CREATE MATERIALIZED VIEW "company_recruiter_aggregates" AS
SELECT
  rec.company_id AS company_id,
  AVG(rrat.reachability)::numeric(4, 2) AS avg_reachability,
  AVG(rrat.responsiveness)::numeric(4, 2) AS avg_responsiveness,
  AVG(rrat.guidelines_shared)::numeric(4, 2) AS avg_guidelines_shared,
  COUNT(*)::int AS sample_size
FROM "recruiter_ratings" rrat
JOIN "recruiter_interactions" ri ON ri.id = rrat.recruiter_interaction_id
JOIN "recruiters" rec ON rec.id = ri.recruiter_id
WHERE rrat.status = 'approved'
GROUP BY rec.company_id;

CREATE UNIQUE INDEX "company_recruiter_aggregates_company_id_key"
  ON "company_recruiter_aggregates" (company_id);
