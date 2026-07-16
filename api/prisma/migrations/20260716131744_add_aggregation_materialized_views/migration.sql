-- Aggregation layer per docs/DATA_MODEL.md "Aggregation layer" section.
-- Not modeled in schema.prisma — Prisma doesn't manage materialized views
-- well, see the note at the bottom of prisma/schema.prisma. This is a raw
-- SQL migration and stays one.
--
-- Refresh strategy: none yet. These views only reflect data as of the last
-- REFRESH MATERIALIZED VIEW call (or migration time). Deciding when to
-- refresh (on-read, on a schedule, or event-driven once workers/ exists) is
-- explicitly out of scope here — see docs/ROADMAP.md Phase 4 issue #9,
-- which actually queries these.
--
-- Only ever aggregates status = 'approved' rows — pending/rejected/flagged
-- rows must never influence a public-facing number (CLAUDE.md hard
-- constraint #2 / docs/DECISIONS.md D3).

-- CreateMaterializedView: company_round_type_aggregates
-- Grain: (company_id, round_type)
CREATE MATERIALIZED VIEW "company_round_type_aggregates" AS
SELECT
  ip.company_id AS company_id,
  r.round_type AS round_type,
  AVG(rr.difficulty)::numeric(4, 2) AS avg_difficulty,
  AVG(rr.fairness)::numeric(4, 2) AS avg_fairness,
  AVG(rr.communication_fluency)::numeric(4, 2) AS avg_communication_fluency,
  AVG(rr.attentiveness)::numeric(4, 2) AS avg_attentiveness,
  AVG(rr.bias_signal)::numeric(4, 2) AS avg_bias_signal,
  COUNT(*)::int AS sample_size
FROM "round_ratings" rr
JOIN "rounds" r ON r.id = rr.round_id
JOIN "interview_processes" ip ON ip.id = r.process_id
WHERE rr.status = 'approved'
GROUP BY ip.company_id, r.round_type;

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY, which issue #9 (or
-- whatever ends up refreshing this) will want to avoid locking readers out
-- during a refresh.
CREATE UNIQUE INDEX "company_round_type_aggregates_company_id_round_type_key"
  ON "company_round_type_aggregates" (company_id, round_type);

-- CreateMaterializedView: company_recruiter_aggregates
-- Grain: (company_id). Joins through recruiters (not interview_processes) —
-- a recruiter belongs to exactly one company already.
--
-- No write path creates recruiter_ratings yet (Phase 2 only built
-- Company -> InterviewProcess -> Round -> RoundRating), so this view is
-- schema-correct but will stay empty until that entity exists — same
-- pattern already noted for ModerationService's entityType handling.
CREATE MATERIALIZED VIEW "company_recruiter_aggregates" AS
SELECT
  rec.company_id AS company_id,
  AVG(rrat.approachability)::numeric(4, 2) AS avg_approachability,
  AVG(rrat.response_time)::numeric(4, 2) AS avg_response_time,
  AVG(rrat.timeliness)::numeric(4, 2) AS avg_timeliness,
  AVG(rrat.communication_quality)::numeric(4, 2) AS avg_communication_quality,
  COUNT(*)::int AS sample_size
FROM "recruiter_ratings" rrat
JOIN "recruiter_interactions" ri ON ri.id = rrat.recruiter_interaction_id
JOIN "recruiters" rec ON rec.id = ri.recruiter_id
WHERE rrat.status = 'approved'
GROUP BY rec.company_id;

CREATE UNIQUE INDEX "company_recruiter_aggregates_company_id_key"
  ON "company_recruiter_aggregates" (company_id);

-- CreateMaterializedView: company_overall_aggregates
-- Grain: (company_id) only for now — docs/DATA_MODEL.md recommends starting
-- company-wide and adding a role_title_normalized slice once there's volume
-- to justify it (same D9/D5 phasing already used elsewhere).
--
-- No write path creates overall_reviews yet either — same caveat as
-- company_recruiter_aggregates above.
CREATE MATERIALIZED VIEW "company_overall_aggregates" AS
SELECT
  ip.company_id AS company_id,
  AVG(orv.overall_experience)::numeric(4, 2) AS avg_overall_experience,
  ROUND(AVG(CASE WHEN orv.would_recommend THEN 100.0 ELSE 0.0 END), 2) AS pct_would_recommend,
  COUNT(*)::int AS sample_size
FROM "overall_reviews" orv
JOIN "interview_processes" ip ON ip.id = orv.process_id
WHERE orv.status = 'approved'
GROUP BY ip.company_id;

CREATE UNIQUE INDEX "company_overall_aggregates_company_id_key"
  ON "company_overall_aggregates" (company_id);
