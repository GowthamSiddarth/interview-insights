# Phase 1.2 — Prisma Schema & First Migration

*Part of Phase 1 — Foundation. See `docs/ROADMAP.md` Phase 1, `docs/DATA_MODEL.md`,
`docs/DECISIONS.md` D1/D2/D4/D5/D6/D7/D8.*

## Why this came first

`docs/DATA_MODEL.md` explicitly states: "This is the source-of-truth
schema. Write migrations directly from this spec. Do not hand-edit
production schema — every change here should become a versioned migration
file." Before a single API endpoint could be built, the data model had to
exist as real, enforced Postgres schema — not just a design doc. Getting
the entity hierarchy and constraints right at this stage is what let every
later phase (moderation, analytics, search) build on a schema that never
needed a breaking change, only additive ones.

## Key concepts

The schema encodes five design principles directly (`docs/DATA_MODEL.md`
"Design principles"), each with real consequences for how the tables are
shaped:

1. **Anonymize identity, not accountability** (D2). Interviewers and
   recruiters are real internal entities — stored so ratings roll up
   correctly and dedupe across reviews — but `interviewers`/`recruiters`
   never expose a real name publicly. Only `internal_identifier_hash`
   (for de-dup) and a generated `display_label` ("Interviewer A") exist;
   there's no `name` column to accidentally leak. This is a defamation-risk
   mitigation, not a UX nicety — the schema makes it structurally
   impossible to serialize a real name by accident, because the real name
   was never stored in the first place.
2. **Ratings are atomic rows, never pre-averaged** (D7). No table has a
   running-average column. Every aggregate is computed from raw
   `round_ratings`/`recruiter_ratings`/`overall_reviews` rows — this is
   what lets later recomputation, backfills, and dispute-driven deletions
   stay correct without a drift bug creeping in.
3. **One rating per candidate per round/interaction** (D8). Enforced with
   real unique constraints — `UNIQUE(round_id, candidate_id)` and
   `UNIQUE(recruiter_interaction_id, candidate_id)` — not just
   application-level validation. A candidate physically cannot insert a
   second rating for the same round; the database rejects it.
4. **Type-specific fields live in JSONB, not new columns per round type.**
   `rounds.type_metadata` is a nullable JSONB column holding whatever a
   `coding` round needs (`language_used`, `platform`, `problem_topic`)
   that a `case_study` round doesn't (`framework_provided`,
   `industry_context`). This keeps the base `rounds` table schema stable
   as new round types get added later — a new round type is a new
   `RoundType` enum value and a documented JSON shape, never a migration
   adding a column.
5. **Moderation status gates visibility everywhere** (D3). Every
   user-generated table (`round_ratings`, `recruiter_ratings`,
   `overall_reviews`) has a `status` column defaulting to `pending`,
   modeled as a shared `ModerationStatus` enum
   (`pending`/`approved`/`rejected`/`flagged`). No public query is
   supposed to read these tables without a `status = 'approved'` filter —
   that discipline is enforced at the API layer in later phases, but the
   column exists here, on every table that needs it, from the very first
   migration.

## Core technologies

- **Prisma schema language** (`schema.prisma`) as the single hand-edited
  source, generating both the TypeScript client and (via `prisma migrate
  dev`) the SQL migration.
- **PostgreSQL-specific column types** used deliberately: `uuid` primary
  keys (`@db.Uuid`), `timestamptz` for every timestamp (`@db.Timestamptz`
  — never a naive timestamp, to avoid timezone ambiguity later), `smallint`
  for 1–5 rating scales (`@db.SmallInt` — no need for a full `int`), and
  `jsonb` for `type_metadata`.
- **Raw SQL, appended to a Prisma-generated migration**, for the one thing
  Prisma's schema language can't express: `CHECK` constraints.

## System design approach

The schema is a direct, table-for-table translation of
`docs/DATA_MODEL.md`'s "Core tables" section, modeled as a strict
hierarchy:

```
Company
  └── InterviewProcess (one candidate's application loop)
        ├── Round (phase, title, type, interviewer, description)
        │     └── RoundRating (difficulty, fairness, interviewer traits)
        ├── RecruiterInteraction
        │     └── RecruiterRating (approachability, response time, timeliness)
        └── OverallReview (summary review for the whole process)
```

Two things this design deliberately does **not** do yet, both of which
show up as explicit, dated decisions rather than accidents:

- **`normalized_band` is schema-ready but unused** (D5). `interview_processes`
  has a nullable `normalized_band` enum column
  (`entry`/`mid`/.../`unmapped`) and a whole `company_level_mappings`
  table exists — but nothing populates them yet. Level semantics ("L5")
  vary wildly across companies, and guessing a mapping up front would be
  worse than not having one. The column exists so a future batch backfill
  job has somewhere to write, without a schema change at that point.
- **The aggregation layer is intentionally *not* in `schema.prisma` at
  all.** `company_round_type_aggregates`, `company_recruiter_aggregates`,
  and `company_overall_aggregates` (`docs/DATA_MODEL.md`'s "Aggregation
  layer") are Postgres materialized views, and Prisma doesn't manage views
  well as first-class schema objects. The schema file has an explicit
  comment marking where they'll go, but they're deferred to a dedicated
  raw-SQL migration when Phase 4 (analytics) actually starts — see that
  phase's blog post for how they get built.

## The one real wrinkle: CHECK constraints

Every 1–5 rating column (`difficulty`, `fairness`,
`communication_fluency`, `attentiveness`, `bias_signal`,
`technical_depth`, `approachability`, `response_time`, `timeliness`,
`communication_quality`, `overall_experience`) needs a `CHECK (value
BETWEEN 1 AND 5)` constraint — enforced by Postgres itself, not just
validated in application code, so a bug in a future API layer can never
write an out-of-range rating. Prisma's schema language has no `@@check`
attribute (as of this schema's Prisma version), so these constraints
can't be declared alongside the column definitions the way a
`@@unique` can.

The fix: generate the migration normally with `prisma migrate dev
--create-only`, then hand-append raw `ALTER TABLE ... ADD CONSTRAINT ...
CHECK (...)` statements to the end of the generated `migration.sql` file,
right after the last Prisma-generated `AddForeignKey` statement:

```sql
-- CheckConstraints (1-5 rating scales; not expressible in Prisma schema
-- language — see docs/DATA_MODEL.md and the comments on RoundRating /
-- RecruiterRating / OverallReview in prisma/schema.prisma)
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_difficulty_check"
  CHECK ("difficulty" BETWEEN 1 AND 5);
ALTER TABLE "round_ratings" ADD CONSTRAINT "round_ratings_technical_depth_check"
  CHECK ("technical_depth" IS NULL OR "technical_depth" BETWEEN 1 AND 5);
-- ...and so on for every 1-5 column across round_ratings, recruiter_ratings,
-- and overall_reviews.
```

Note the nullable-column pattern (`technical_depth`): the constraint has
to explicitly allow `NULL` for nullable rating columns, since a bare
`CHECK (technical_depth BETWEEN 1 AND 5)` would reject `NULL` outright
(Postgres `CHECK` constraints pass on `NULL` by default only if the
expression itself evaluates to `NULL`/unknown rather than `false` — the
explicit `IS NULL OR` makes that intent unambiguous rather than relying on
that subtlety). Prisma migrations are otherwise 100% auto-generated from
`schema.prisma` — this is the single hand-written exception, and it's
called out with a comment both at the point of use in the schema file and
at the point of definition in the migration SQL, so a future schema
change doesn't accidentally regenerate the migration and silently drop
these constraints.

## Step-by-step: what actually got built

1. **Transcribed `docs/DATA_MODEL.md`'s "Core tables" section into
   `schema.prisma`**, table by table, in the exact order the doc's
   "Migration ordering" section specifies (this matters because later
   tables have foreign keys into earlier ones — `interview_processes`
   can't exist before `companies` and `candidates` do):
   1. `companies`, `candidates`
   2. `interview_processes`
   3. `interviewers`, `recruiters`
   4. `rounds`
   5. `round_ratings`
   6. `recruiter_interactions`
   7. `recruiter_ratings`
   8. `overall_reviews`
   9. `moderation_queue`
   10. `company_level_mappings` (schema-ready, unused — see D5 above)
2. **Modeled every enum-like text field as a real Prisma `enum`** rather
   than a free-text column with an implied set of valid values —
   `CompanySizeBucket`, `VerificationStatus`, `ProcessOutcome`,
   `NormalizedBand`, `RoundType`, `ModerationStatus`,
   `ModerationEntityType`, `ModerationFlagReason`. This turns "the outcome
   is one of offer/rejected/withdrawn/ghosted/in_progress" from a
   documentation comment into something Postgres itself enforces at the
   column type level.
3. **Added indexes matching `docs/DATA_MODEL.md`'s explicit index list** —
   e.g. `(company_id, role_title)` and `(company_id, created_at)` on
   `interview_processes`, `(process_id, sequence_number)` and
   `(round_type)` on `rounds` — anticipating the query patterns later
   phases would need (looking up a company's processes by role, or a
   process's rounds in order) before those endpoints existed yet.
4. **Added the two unique constraints implementing D8** —
   `@@unique([roundId, candidateId])` on `RoundRating` and
   `@@unique([recruiterInteractionId, candidateId])` on `RecruiterRating`.
5. **Ran `prisma migrate dev --name init --create-only`** to generate the
   SQL without applying it yet, so the CHECK constraints below could be
   appended before the migration ever touched a real database.
6. **Hand-appended the CHECK constraints** (see above) to the end of the
   generated `migration.sql`, each with a comment explaining why it isn't
   in `schema.prisma` itself.
7. **Applied the migration** (`prisma migrate deploy` against the local
   Postgres from the Phase 1.3 docker-compose setup) and confirmed via
   `\d round_ratings` in `psql` that every CHECK constraint actually
   registered — not just that the migration ran without error.
8. **Left the aggregation layer's comment-only placeholder** in
   `schema.prisma` (see the "System design approach" section above),
   explicitly deferring it rather than guessing at materialized view SQL
   before Phase 4 needed it.

## What this enabled

Phase 2's Create+Read endpoints could be built directly against
`PrismaClient`'s generated types with zero schema changes. Phase 3's
moderation queue added exactly one new table
(`moderation_queue`, already present from this migration) and one new
migration for `CandidateVerificationToken` — neither touched
`round_ratings`/`recruiter_ratings`/`overall_reviews` at all, because the
`status` column those later phases gate on had already existed since this
first migration. The schema didn't need a single breaking change across
five subsequent phases of feature work — the payoff of modeling the full
domain correctly before writing any application code.
