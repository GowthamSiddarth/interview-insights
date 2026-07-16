# Phase 4, Issue #7 — Aggregation Materialized Views

*Part of Phase 4 — Analytics. See `docs/ROADMAP.md` Phase 4, `docs/DATA_MODEL.md`
"Aggregation layer", `docs/DECISIONS.md` D9/D15.*

## Why this came first

Every score this platform will ever show publicly — average difficulty
for a company's coding rounds, average recruiter approachability, overall
recommend percentage — has to come from *somewhere* that isn't a live
`AVG()` query re-scanning every raw rating row on every request. Issue #7
is that "somewhere": three materialized views, built before any endpoint
reads from them, so the later issues in this phase (shrinkage scoring, the
analytics endpoint, the dashboard) have real, correctly-shaped aggregate
data to build against from the start.

## Key concepts

- **Materialized views before a separate OLAP store** (`docs/DECISIONS.md`
  D9). `docs/ARCHITECTURE.md`'s target architecture eventually wants
  ClickHouse for pre-aggregated rollups — but that's a second datastore to
  run, sync, and operate, and nothing has proven Postgres materialized
  views insufficient yet. Building the simpler thing first, and writing
  down exactly what would trigger the more complex thing later, is the
  same discipline Phase 1.3 applied to Redis/Kafka and Phase 3 applied to
  the moderation queue's transport.
- **Only approved rows ever feed a public aggregate.** Every one of the
  three views' `WHERE` clauses filters `status = 'approved'` — this is
  not optional or an afterthought, it's the same hard constraint
  (CLAUDE.md #2 / D3) that gates every other public surface in this
  project, now enforced at the SQL level in the view definition itself
  rather than relying on every future caller to remember to filter.
- **A zero-approved group produces no row at all — never a row of nulls
  or zeros.** `GROUP BY` naturally does this (a group with zero matching
  rows simply doesn't appear in the result set), but it's worth stating
  explicitly as a design intent, not an accident: a company with zero
  approved coding-round ratings should be indistinguishable, at the data
  layer, from a company that's never been rated at all — both should
  produce *no row*, not a row where every average is `NULL`. Getting this
  wrong would push a "is this actually zero data, or a null-average bug"
  question onto every later consumer.
- **Views are prepared for concurrent refresh from day one**, even though
  nothing refreshes them yet. Postgres's `REFRESH MATERIALIZED VIEW
  CONCURRENTLY` — which refreshes a view without holding a lock that
  blocks readers — requires a unique index on the view first. Adding that
  index now, in the same migration that creates the view, means the
  *eventual* refresh mechanism (deferred to issue #9, see D15) never has
  to circle back and retrofit it.

## Core technologies

- **Raw SQL migrations**, not `schema.prisma` — Prisma doesn't manage
  materialized views as first-class schema objects, so this is a
  hand-written `CREATE MATERIALIZED VIEW` migration, generated via
  `prisma migrate dev --create-only` and then filled in by hand (the same
  technique Phase 1.2 used for CHECK constraints, now applied to a whole
  migration file rather than an appended fragment).
- **Postgres `numeric(4,2)` casts** on every averaged column
  (`AVG(rr.difficulty)::numeric(4,2)`) — a 1–5 rating scale never needs
  more than two decimal places of precision, and fixing the type
  explicitly avoids `numeric` with unbounded precision/scale silently
  propagating through every downstream calculation.
- **`GROUP BY` at three different grains**, one per view, matching
  exactly what `docs/DATA_MODEL.md`'s "Aggregation layer" section
  specifies:

| View | Grain | Joins through |
|---|---|---|
| `company_round_type_aggregates` | `(company_id, round_type)` | `round_ratings → rounds → interview_processes` |
| `company_recruiter_aggregates` | `(company_id)` | `recruiter_ratings → recruiter_interactions → recruiters` |
| `company_overall_aggregates` | `(company_id)` | `overall_reviews → interview_processes` |

## System design approach

Each view is a straight `SELECT ... GROUP BY` over the join path that
connects its rating table back to `company_id`, filtered to approved rows
only:

```sql
CREATE MATERIALIZED VIEW "company_round_type_aggregates" AS
SELECT
  ip.company_id AS company_id,
  r.round_type AS round_type,
  AVG(rr.difficulty)::numeric(4, 2) AS avg_difficulty,
  -- ...every other 1-5 metric...
  COUNT(*)::int AS sample_size
FROM "round_ratings" rr
JOIN "rounds" r ON r.id = rr.round_id
JOIN "interview_processes" ip ON ip.id = r.process_id
WHERE rr.status = 'approved'
GROUP BY ip.company_id, r.round_type;

CREATE UNIQUE INDEX "company_round_type_aggregates_company_id_round_type_key"
  ON "company_round_type_aggregates" (company_id, round_type);
```

One deliberate, forward-looking wrinkle: **two of the three views ship
schema-correct but permanently empty at this point in the project.**
`company_recruiter_aggregates` and `company_overall_aggregates` join
through `recruiter_ratings` and `overall_reviews` — but Phase 2 only ever
built a write path for `round_ratings` (the "Round" leg of `Company →
InterviewProcess → Round → RoundRating`; recruiter interactions and
overall reviews were modeled in Phase 1's schema but never got their own
endpoints). Building the *aggregation* for entities that don't have a
*write path* yet might look premature — but it isn't, for the same
reason issue #1's moderation queue already handled a similar gap
(`ModerationService` throwing `NotImplementedException` for entity types
with no writer): `docs/DATA_MODEL.md`'s full schema was the source of
truth from Phase 1 onward, and building the *reading* side of a
documented, schema-ready entity ahead of its writer means zero rework
later — when `recruiter_ratings` eventually gets a real write path, this
view starts populating with no migration needed at all.

The percent-recommend calculation in `company_overall_aggregates` is
worth a specific callout, since "average a boolean" isn't an obvious SQL
pattern:

```sql
ROUND(AVG(CASE WHEN orv.would_recommend THEN 100.0 ELSE 0.0 END), 2) AS pct_would_recommend
```

`CASE WHEN ... THEN 100.0 ELSE 0.0 END` turns each boolean row into
`100` or `0`, and `AVG()` over that column is exactly the percentage of
`true` values — a small, reusable trick for "what percent of rows have
this boolean set" in plain SQL without a separate `COUNT(*) FILTER
(WHERE ...)` and manual division.

## Step-by-step: what actually got built

1. **Read `docs/DATA_MODEL.md`'s "Aggregation layer" section** as the
   exact spec — three views, their grains, their columns, all already
   fully decided before this issue started (a benefit of the "plan the
   whole phase's issues before implementing any of them" convention:
   issue #7 didn't need to *design* the aggregation layer, only build the
   already-designed one).
2. **Wrote one raw SQL migration** (`20260716131744_add_aggregation_
   materialized_views`) with all three `CREATE MATERIALIZED VIEW`
   statements plus their unique indexes, each block commented with its
   grain and the approved-only filter reasoning.
3. **Confirmed the empty-group behavior explicitly in a test**, rather
   than assuming `GROUP BY`'s default behavior without verifying it: a
   company with zero approved ratings of a given round type produces zero
   rows in `company_round_type_aggregates` for that grain, not a row of
   nulls.
4. **Wrote 4 integration tests** (`aggregation-views.e2e-spec.ts`)
   against a real Postgres, seeding rows at varying approval statuses and
   proving all three views compute correctly from approved-only data.
5. **Deliberately did not build a refresh mechanism** in this issue — see
   `docs/DECISIONS.md` D15: deciding *when* to refresh (on-read, on a
   schedule, event-driven) depends on what actually reads these views,
   which doesn't exist until issue #9. Guessing at a refresh strategy
   before there's a reader would be exactly the kind of premature design
   this project consistently avoids.

## What this enabled

Issue #8's shrinkage scoring and issue #9's analytics endpoint both query
these views directly, with zero additional schema work — the unique
indexes added here (seemingly unused at the time) are exactly what let
issue #9's eventual refresh strategy use `REFRESH MATERIALIZED VIEW
CONCURRENTLY` without a later migration. The "build the read-side of a
schema-ready entity ahead of its writer" pattern demonstrated here (for
`recruiter_ratings`/`overall_reviews`) is a genuinely reusable lesson for
any project working from a complete, upfront data model: it's often
cheaper to build the aggregation/read logic once, against the full
schema, than to build it twice — once now for what has a writer, and
again later when the rest catches up.
