# Phase 19, Issue #162 — Near-Duplicate Review Detection

*Part of Phase 19 — Content Quality & Synthetic Data. See `docs/ROADMAP.md`
Phase 19 and `docs/DECISIONS.md` D64.*

## Why this phase exists at all

Phase 19 was filed the same day as Phase 18, back when Phase 3's fraud
checks (D13) were still fairly young: exact-match duplicate detection,
computed by pulling every existing row for a table and comparing strings
in application code. That was fine at the volume the platform had then.
Seven months and a dozen phases later — Phase 24's rating redesign,
Phase 25/26's bulk submission endpoint, Phase 29's fraud-check reframing
to count submissions instead of entities — the original assumptions
behind this issue needed a second look before writing any code, which is
why a kickoff brainstorm ran first rather than just picking up the
original issue text as-is.

## Key concept: what D13 actually got wrong

D13's duplicate check normalized whitespace/case and then did a
full-table scan comparing strings byte-for-byte. That catches a candidate
pasting the exact same review twice. It does not catch the far more
common case: the same review, lightly reworded, or with one typo fixed.
Two submissions that are 95% identical text sailed straight through the
old check as two entirely unrelated reviews.

## Key concept: `pg_trgm`, not embeddings

The kickoff brainstorm's first resolved decision was the approach:
Postgres's built-in `pg_trgm` extension and its `similarity()` function,
not an embeddings-based semantic-similarity service. The reasoning is
architectural, not just "simpler": `pg_trgm` computes similarity **inside
Postgres**, as a single `$queryRaw` call, with no new external
dependency, no vector store, and no second system that could disagree
with the source of truth about what data exists. An embeddings approach
would have meant standing up a whole new piece of infrastructure to solve
a problem trigram similarity already solves well for short, human-written
review text.

`similarity()` returns a score from 0 (nothing in common) to 1 (identical)
based on shared three-character substrings between two strings. An exact
match after normalizing whitespace and case is just the score-1.0 case —
so this one check now covers what D13's exact-match logic did *and*
genuine near-duplicates, as a single implementation rather than two.
`0.55` is the starting threshold, the same "placeholder, not tuned
against real data yet" spirit as `RATE_LIMIT_MAX_SUBMISSIONS` and the
shrinkage formula's `k`.

## System design approach

A hand-authored migration
(`20260727173830_enable_pg_trgm_near_duplicate_detection`) does two
things raw SQL has to do because Prisma's schema language can't express
either: `CREATE EXTENSION IF NOT EXISTS pg_trgm`, and a partial GIN
trigram index on `lower(free_text)`/`lower(review_text)` for each of the
three moderated tables — partial because it only indexes non-null rows,
the same "don't index what will never be queried" principle a normal
partial index follows.

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX round_ratings_free_text_trgm_idx
  ON round_ratings USING gin (lower(free_text) gin_trgm_ops)
  WHERE free_text IS NOT NULL;
-- ...and the same shape for recruiter_ratings.free_text,
-- overall_reviews.review_text
```

`FraudChecksService.checkDuplicateFreeText()` replaces its old
`findMany()`-and-compare-in-JS body with one `$queryRaw` call:

```sql
SELECT EXISTS (
  SELECT 1 FROM "round_ratings"
  WHERE "free_text" IS NOT NULL
    AND similarity(lower("free_text"), $1) > 0.55
) AS "found"
```

Scoping stays exactly what GitHub issue #317 already established: a
recruiter rating's `freeText` is only ever compared against other
recruiter ratings' `freeText`, never across entity types.

Applying this migration hit a real, separate rough edge: `prisma migrate
dev`'s shadow-database replay currently fails against this schema —
issue #369's earlier company-moderation-backfill migration queries
`_prisma_migrations` directly, which trips a `P1014` error replaying
from an empty shadow database. Worked around the same way D64 documents
it: hand-author the migration file, then apply it with `prisma migrate
deploy`, which skips the shadow database entirely. Not investigated or
fixed further here — a pre-existing gap this issue's own migration
happened to surface again.

## Step-by-step: what actually got built and verified

1. **The migration** — `pg_trgm` extension + three partial GIN trigram
   indexes, applied via `migrate deploy` to both the dev and
   `interview_insights_test` databases directly.
2. **`checkDuplicateFreeText()` rewritten** around `$queryRaw`, unit
   tests rewritten to mock that call instead of `findMany()` — including
   a dedicated "genuinely reworded, not just case/whitespace-different"
   test case.
3. **A new e2e test** proves a reworded (not exact-match) pair trips
   `duplicate` against real Postgres trigram similarity — something the
   old exact-match implementation could never have caught even with a
   perfect test.
4. **A real test-authoring bug, only visible under the full parallel e2e
   suite.** The file's existing "must not be flagged" fixtures used a
   fixed template sentence plus a short random numeric suffix, to avoid
   colliding with a previous run's leftover rows *under exact-match*
   comparison. Under trigram similarity, that pattern stopped working —
   two runs' strings differ only in a short numeric suffix, so they stay
   well above the 0.55 threshold regardless of the suffix. Fixed by
   generating each fixture's base text with
   `faker.lorem.sentence({ min: 10, max: 16 })` (real word-salad
   diversity, empirically confirmed via direct `similarity()` queries to
   stay under ~0.3 between independent runs); the one test that wants a
   genuine near-duplicate pair wraps a single freshly-generated random
   core phrase in two different framing sentences, so the pair stays
   similar to *each other* by design without colliding with any other
   run's data.
5. Documented as D64 (with a superseded-by note added to D13).

## What this enabled

The platform can now catch a candidate re-submitting the same complaint
with the names changed, a typo fixed, or a sentence reordered — the kind
of near-duplicate that's actually common in real spam and low-effort
submission patterns, not just the literal copy-paste case D13 originally
covered. And because the whole thing is a database-native extension
rather than a new service, it inherited the exact operational
characteristics (backup, replication, no new deploy target) Postgres
already has, at essentially zero infrastructure cost.
