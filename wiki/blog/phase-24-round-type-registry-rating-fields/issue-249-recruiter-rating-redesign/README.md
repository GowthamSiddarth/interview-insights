# Phase 24, Issue #249 — Recruiter Rating Field Redesign

*Part of Phase 24 — Round-Type Registry & Rating Field Redesign. See
`docs/ROADMAP.md` Phase 24 and `docs/DECISIONS.md` D48.*

## Why this one needed a kickoff brainstorm

Issue #247's field mapping was a clean 1:1 rename. Issue #249's wasn't:
the roadmap's target field set (`reachability`, `responsiveness`,
`guidelines-shared`, `rejection-message-authenticity`) didn't map
cleanly onto the four existing columns (`approachability`,
`response_time`, `timeliness`, `communication_quality`) without real
decisions about which fields merge, which get dropped, and how a
genuinely new, sometimes-inapplicable concept like "was the rejection
message authentic" should be modeled. So, following the same pattern
Phase 16/17/21 each used for their own kickoff brainstorms, five open
questions were resolved directly with the project owner *before* any
schema change — and the answers were written back into the issue body
itself, so the decisions wouldn't need re-litigating mid-implementation.

## Key concept: merge fields that measure the same underlying thing

`response_time` (how fast they replied) and `timeliness` (whether they
kept promised commitments) sound distinct in the abstract, but a
candidate rating a recruiter interaction can't cleanly separate "they
replied quickly" from "they did what they said they'd do by when they
said they'd do it" — in practice these are one impression, not two.
They merged into a single `responsiveness` field, the same reasoning
issue #247 used to drop `fairness`/`bias_signal` as overly-correlated
axes rather than force candidates to answer two questions that measure
one thing.

## Key concept: a rename can also reinterpret, not just relabel

`approachability` measured something closer to "were they pleasant to
deal with." `reachability` measures something different: "could you
actually get hold of them when you needed to." These aren't the same
question, but the decision was to let one field absorb the other's
column (via `RENAME COLUMN`, preserving any data) while shifting its
meaning — rather than run both as separate fields, which would have
left `recruiter_ratings` with 5 fields instead of the roadmap's
intended 4. `communication_quality` was the one field dropped outright
with nothing inheriting its column: its signal folds into
`reachability`/`responsiveness`/the free-text field well enough that
keeping it as a fifth, semi-redundant axis wasn't worth the extra
cognitive load on every candidate filling out the form.

## Key concept: a rating that only sometimes applies has to be nullable

"Was the rejection message authentic or clearly automated" only makes
sense for a touchpoint that was actually about a rejection. But
`RecruiterInteraction` has no outcome field of its own — outcome lives
on `InterviewProcess`, and a process can have *many* recruiter
interactions (the schema has supported this since Phase 1; only the
wizard UI ever created a single one). Two designs were on the table:
add a join-time check against `InterviewProcess.outcome = 'rejected'`
to gate the field, or make it a plain nullable column, self-reported by
the candidate's own judgment. The join was rejected: it adds real
complexity for a benefit that doesn't hold up under a closer look — a
candidate might log the interaction before the process's outcome is
even updated to `rejected`, which would incorrectly block a legitimate
answer. The simpler design won: `rejectionMessageAuthenticity` is
nullable, optional, and never validated against process outcome at
all. This is also why it's excluded from the shrinkage-scored analytics
aggregation — the same precedent `round_ratings.technical_depth`
(also nullable) already set: optional fields stay out of the
aggregation layer, visible only via raw per-rating reads.

## System design approach

Same migration shape issue #247 established — drop the dependent
materialized view, rename/drop/add columns, recreate CHECK constraints
under matching names, recreate the view:

```sql
DROP MATERIALIZED VIEW IF EXISTS "company_recruiter_aggregates";

ALTER TABLE "recruiter_ratings" RENAME COLUMN "approachability" TO "reachability";
ALTER TABLE "recruiter_ratings" RENAME COLUMN "response_time" TO "responsiveness";

ALTER TABLE "recruiter_ratings" DROP COLUMN "timeliness";
ALTER TABLE "recruiter_ratings" DROP COLUMN "communication_quality";

ALTER TABLE "recruiter_ratings" ADD COLUMN "guidelines_shared" SMALLINT NOT NULL;
ALTER TABLE "recruiter_ratings" ADD COLUMN "rejection_message_authenticity" SMALLINT;
-- ... CHECK constraints follow the same rename/drop/add pattern,
-- rejection_message_authenticity's allows NULL:
ALTER TABLE "recruiter_ratings" ADD CONSTRAINT "recruiter_ratings_rejection_message_authenticity_check"
  CHECK ("rejection_message_authenticity" IS NULL OR "rejection_message_authenticity" BETWEEN 1 AND 5);

CREATE MATERIALIZED VIEW "company_recruiter_aggregates" AS
SELECT rec.company_id,
  AVG(rrat.reachability)::numeric(4,2)      AS avg_reachability,
  AVG(rrat.responsiveness)::numeric(4,2)    AS avg_responsiveness,
  AVG(rrat.guidelines_shared)::numeric(4,2) AS avg_guidelines_shared,
  COUNT(*)::int AS sample_size
FROM "recruiter_ratings" rrat
JOIN "recruiter_interactions" ri ON ri.id = rrat.recruiter_interaction_id
JOIN "recruiters" rec ON rec.id = ri.recruiter_id
WHERE rrat.status = 'approved'
GROUP BY rec.company_id;
```

`rejection_message_authenticity` is conspicuously absent from the view
— by design.

## Step-by-step: what actually got built and verified

1. **Kickoff brainstorm** — five open questions resolved via
   AskUserQuestion, decisions written back into the issue body and
   `docs/DECISIONS.md` D48 before any code changed.
2. **Migration**: the rename/drop/add/recreate-view sequence above,
   applied to both the dev and disposable test databases (the test
   database needed a `TRUNCATE` first, same D24-documented gotcha
   issue #247 already hit for its own `NOT NULL` column add).
3. **Every consumer updated**: `CreateRecruiterRatingDto`, `MeService`,
   `AnalyticsService`/`GlobalAveragesService`, `ModerationService`'s
   queue-detail serializer, the wizard's recruiter step, `/me`'s edit
   form, the moderation queue UI, the analytics dashboard's recruiter
   section.
4. **4 new unit tests** (DTO bounds/optionality for the new nullable
   field) + **2 new e2e tests** (`rejectionMessageAuthenticity`
   null-when-omitted and real-value round-trip), plus every existing
   test referencing the old field names updated.
5. **Live-verified** via curl against the real dev Postgres: a real
   magic-link login, a rating submitted with the field omitted
   (confirmed `null`), a rating with a real value (confirmed it
   round-trips), an out-of-range value rejected (400), the old field
   names rejected outright by whitelist validation (400), and — after
   approving both ratings and refreshing the materialized view — the
   analytics endpoint returning the correct 3-field shape with a real
   `sampleSize`.

## What this enabled

`recruiter_ratings` now collects exactly the signal the roadmap set out
to capture, with a genuinely optional field modeled as genuinely
optional rather than forced into every submission. With all three
Phase 24 feature issues done, the wizard's rating field shapes are
stable — which is what Phase 25's bulk-submission endpoint and Phase
26's wizard rewrite were both waiting on before they could start.
