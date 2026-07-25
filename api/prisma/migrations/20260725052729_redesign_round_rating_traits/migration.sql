-- GitHub issue #247: limit round_ratings' interviewer traits to three
-- (fluency, clarity, focus). communication_fluency/attentiveness map 1:1
-- onto fluency/focus, so those are true renames (preserves any existing
-- data — the table was empty at the time of writing, but this is still the
-- correct migration shape). fairness/bias_signal are dropped outright
-- (docs/DECISIONS.md D45); clarity is genuinely new.

-- The materialized view depends on the columns being renamed/dropped below
-- (Postgres won't let you touch a column a view depends on) — drop it first,
-- recreate at the end with the new column set.
DROP MATERIALIZED VIEW IF EXISTS "company_round_type_aggregates";

ALTER TABLE "round_ratings" RENAME COLUMN "communication_fluency" TO "fluency";
ALTER TABLE "round_ratings" RENAME COLUMN "attentiveness" TO "focus";

ALTER TABLE "round_ratings" DROP COLUMN "fairness";
ALTER TABLE "round_ratings" DROP COLUMN "bias_signal";
ALTER TABLE "round_ratings" ADD COLUMN "clarity" SMALLINT NOT NULL;

-- The renamed columns keep their existing CHECK constraints under their old
-- names (Postgres doesn't auto-rename constraint names on RENAME COLUMN) —
-- drop and recreate under names that match the new columns. The dropped
-- columns' constraints go with them implicitly, but drop explicitly too so
-- this migration is self-documenting.
ALTER TABLE "round_ratings" DROP CONSTRAINT IF EXISTS "round_ratings_communication_fluency_check";
ALTER TABLE "round_ratings" DROP CONSTRAINT IF EXISTS "round_ratings_attentiveness_check";
ALTER TABLE "round_ratings" DROP CONSTRAINT IF EXISTS "round_ratings_fairness_check";
ALTER TABLE "round_ratings" DROP CONSTRAINT IF EXISTS "round_ratings_bias_signal_check";

ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_fluency_check" CHECK ("fluency" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_focus_check" CHECK ("focus" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_clarity_check" CHECK ("clarity" BETWEEN 1 AND 5);

-- Recreate the view (not Prisma-managed, see schema.prisma's own comment)
-- with the new column set.
CREATE MATERIALIZED VIEW "company_round_type_aggregates" AS
SELECT
  ip.company_id AS company_id,
  r.round_type AS round_type,
  AVG(rr.difficulty)::numeric(4, 2) AS avg_difficulty,
  AVG(rr.fluency)::numeric(4, 2) AS avg_fluency,
  AVG(rr.clarity)::numeric(4, 2) AS avg_clarity,
  AVG(rr.focus)::numeric(4, 2) AS avg_focus,
  COUNT(*)::int AS sample_size
FROM "round_ratings" rr
JOIN "rounds" r ON r.id = rr.round_id
JOIN "interview_processes" ip ON ip.id = r.process_id
WHERE rr.status = 'approved'
GROUP BY ip.company_id, r.round_type;

CREATE UNIQUE INDEX "company_round_type_aggregates_company_id_round_type_key"
  ON "company_round_type_aggregates" (company_id, round_type);
