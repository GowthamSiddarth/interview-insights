# Phase 24, Issue #247 — Round Rating Trait Redesign

*Part of Phase 24 — Round-Type Registry & Rating Field Redesign. See
`docs/ROADMAP.md` Phase 24.*

## Why this came first

Phases 24-26 were planned together in one pass, from a UI/UX brainstorm
about streamlining round-level rating detail and rewriting the wizard
around client-side drafting. Of the three Phase 24 issues, #247 was the
natural place to start: it's the one with a genuinely clean mapping —
`round_ratings` already had five interviewer-adjacent columns
(`difficulty`, `communication_fluency`, `attentiveness`, `fairness`,
`bias_signal`), and the redesign's target shape (`fluency`, `clarity`,
`focus`) was a straightforward rename-and-reduce, not an open design
question the way issue #249's recruiter-field mapping turned out to be.

## Key concept: difficulty is a different axis than the interviewer traits

`difficulty` measures the round/problem itself — how hard the coding
question or system-design prompt was. The other three columns measure
the *interviewer's* conduct. That distinction already existed in the
schema's comments before this issue touched anything, and it's why
`difficulty` was untouched here while the other four columns were
redesigned: conflating "the problem was hard" with "the interviewer was
unclear" would have been exactly the kind of muddled metric this
redesign was trying to avoid.

## Key concept: drop what doesn't add signal, don't just rename everything

`fairness` and `bias_signal` were dropped outright, not renamed. Both
were vague enough in practice to invite inconsistent interpretation
across candidates, and neither survived scrutiny as a distinct,
well-defined axis separate from the three that remained. `clarity` is
genuinely new — clarity of the problem statement itself, distinct from
`fluency` (how clearly the interviewer communicated) and `focus`
(attentiveness/presence during the interview). The end result is a
tighter, three-trait interviewer surface: `fluency`, `clarity`, `focus`
— plus `difficulty` as its own axis.

## System design approach

Two real columns are true renames (`communication_fluency` → `fluency`,
`attentiveness` → `focus`), which matters because Prisma's own migration
diffing can't detect a rename — left to its own devices, `prisma migrate
dev` generates a lossy `DROP COLUMN` + `ADD COLUMN` pair that would
discard any existing data. The migration file has to be hand-edited into
explicit `ALTER TABLE ... RENAME COLUMN` statements instead:

```sql
DROP MATERIALIZED VIEW IF EXISTS "company_round_type_aggregates";

ALTER TABLE "round_ratings" RENAME COLUMN "communication_fluency" TO "fluency";
ALTER TABLE "round_ratings" RENAME COLUMN "attentiveness" TO "focus";

ALTER TABLE "round_ratings" DROP COLUMN "fairness";
ALTER TABLE "round_ratings" DROP COLUMN "bias_signal";
ALTER TABLE "round_ratings" ADD COLUMN "clarity" SMALLINT NOT NULL;

-- old CHECK constraints don't survive a rename under their old names —
-- drop and recreate under names that match the new columns
ALTER TABLE "round_ratings" DROP CONSTRAINT IF EXISTS "round_ratings_communication_fluency_check";
ALTER TABLE "round_ratings" DROP CONSTRAINT IF EXISTS "round_ratings_attentiveness_check";
ALTER TABLE "round_ratings" DROP CONSTRAINT IF EXISTS "round_ratings_fairness_check";
ALTER TABLE "round_ratings" DROP CONSTRAINT IF EXISTS "round_ratings_bias_signal_check";

ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_fluency_check" CHECK ("fluency" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_focus_check" CHECK ("focus" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_clarity_check" CHECK ("clarity" BETWEEN 1 AND 5);

CREATE MATERIALIZED VIEW "company_round_type_aggregates" AS
SELECT ip.company_id, r.round_type,
  AVG(rr.difficulty)::numeric(4,2) AS avg_difficulty,
  AVG(rr.fluency)::numeric(4,2)    AS avg_fluency,
  AVG(rr.clarity)::numeric(4,2)    AS avg_clarity,
  AVG(rr.focus)::numeric(4,2)      AS avg_focus,
  COUNT(*)::int AS sample_size
FROM "round_ratings" rr
JOIN "rounds" r ON r.id = rr.round_id
JOIN "interview_processes" ip ON ip.id = r.process_id
WHERE rr.status = 'approved'
GROUP BY ip.company_id, r.round_type;
```

The materialized view has to be dropped before the columns it depends on
can be renamed or dropped — Postgres refuses to touch a column a view
references — then recreated afterward with the new column set. This is
the same shape every future field-renaming migration on this project
follows (issue #249's recruiter-field redesign reused it directly).

Every consumer of the old field names needed updating in the same pass:
DTOs, `RoundRatingsService`, `ReviewSearchService`, `MeService`,
`CompaniesService`, `ModerationService`, `AnalyticsService`/
`GlobalAveragesService`, the wizard's rating form, `/me`'s edit form, the
company profile page, the analytics dashboard, the search page, and the
moderation queue detail view.

## Step-by-step: what actually got built and verified

1. **Schema + migration**: `RoundRating` model updated; migration file
   hand-edited from Prisma's generated lossy diff into the rename/drop/
   add shape above, including dropping and recreating
   `company_round_type_aggregates`.
2. **Every backend/frontend consumer updated** in the same pass — a
   deliberate choice, since leaving any surface on the old field names
   would have meant a silent runtime mismatch rather than a compile-time
   or test failure.
3. **Two real, pre-existing test-database gaps surfaced and fixed**
   along the way: `interview_insights_test` (a genuinely separate
   database from dev) had never had this migration applied, needing its
   own `prisma migrate deploy`; and 112 leftover `round_ratings` rows
   from prior test runs blocked the new `NOT NULL` `clarity` column —
   truncated, since `interview_insights_test` is disposable test data by
   design (D24).
4. Full suite green — every unit/e2e/smoke test referencing the old
   field names updated and passing.
5. **Live-verified** through the real Ingress-fronted app: a wizard
   submission with the new fields, `/me` echoing them back correctly, an
   anonymous analytics-page visit still correctly showing Phase 21's
   soft-gate (proving this wasn't a regression), and a logged-in visit
   showing the real `fluency`/`clarity`/`focus` labels — zero console
   errors throughout.

## What this enabled

A tighter, better-defined interviewer-trait surface, and — just as
importantly — a proven migration shape (drop-view → rename/drop/add
columns → recreate-view) that issue #249 could reuse directly rather
than re-deriving from scratch. It also set the stage for issue #248: with
the rating-field shapes settled, the round-type registry could be built
against a known-stable `round_ratings` schema instead of one still in
flux.
