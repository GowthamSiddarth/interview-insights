# Phase 4, Issue #8 — Shrinkage Scoring

*Part of Phase 4 — Analytics. See `docs/ROADMAP.md` Phase 4, `docs/DATA_MODEL.md`
"Aggregation layer", `docs/DECISIONS.md` D4.*

## Why this came first

Issue #7 built raw per-company averages. But a raw average is a bad
number to show publicly at small sample sizes — a company with exactly 3
approved ratings averaging 5.0 looks identical to a company with 300
ratings averaging 5.0, even though the first is barely more informative
than a coin flip and the second is a genuinely reliable signal. Issue #8
builds the statistical technique that fixes this, before the analytics
endpoint (issue #9) or the dashboard (issue #10) have anything real to
display.

## Key concepts — this is the most transferable idea in the whole project

**Shrinkage estimation** (also called Bayesian shrinkage, or "regression
to the mean" applied deliberately) is a general statistics technique, not
specific to interview ratings — it's directly reusable in any product
showing a per-entity average computed from a variable, sometimes-small
number of samples: seller ratings on a marketplace, restaurant ratings,
book ratings, A/B test conversion rates for low-traffic variants. The
core idea:

> Pull an entity's own average toward the *platform-wide* average, by an
> amount that shrinks as that entity's own sample size grows. With very
> few samples, trust the platform average almost entirely (the entity's
> own average could easily be noise). With many samples, trust the
> entity's own average almost entirely (noise has washed out).

- **Why not just a hard cutoff** (e.g. "hide averages below n=5")?
  Because it creates a discontinuity that misleads exactly at the
  boundary: a company at `n=4` shows nothing, and a company at `n=5`
  suddenly shows a raw average that's *still* barely more reliable than
  the hidden one — the cutoff creates a false impression of a meaningful
  jump in data quality that isn't real. Shrinkage has no such cliff: the
  displayed number moves smoothly as `n` grows, always somewhere between
  "mostly the platform average" and "mostly this entity's own average,"
  never a sudden jump.
- **A hard floor still exists, and shrinkage doesn't replace it** — below
  `n=3`, nothing is shown at all (`null`, rendered as "not enough reviews
  yet" by the frontend). Shrinkage makes samples *above* that floor
  trustworthy at every size; it doesn't manufacture information out of
  one or two data points, which would still be actively misleading no
  matter how it's blended.
- **`sample_size` is always shown too, transparently, never hidden.**
  This is a deliberate anti-pattern-avoidance: a shrunk score without its
  sample size looks exactly like a "real" average, and a user has no way
  to judge how much to trust it. Showing `n` alongside the score lets a
  user apply their own judgment (`4.2 (3 reviews)` reads very differently
  from `4.2 (300 reviews)`, even though the shrinkage math already
  accounts for the difference internally).

## Core technologies

- **The formula itself**, a weighted average between the entity's own
  mean and the global mean, weighted by sample size versus a tunable
  confidence constant `k`:

  ```
  displayed_score = (n / (n + k)) * company_avg + (k / (n + k)) * global_avg
  ```

  As `n → 0`, the weight on `company_avg` goes to `0` and the weight on
  `global_avg` goes to `1` — the score is almost entirely the platform
  average. As `n → ∞`, the reverse — the score converges to the
  company's true average. `k` controls *how fast* that convergence
  happens: a larger `k` means it takes more samples before the company's
  own data dominates; `k=8` here means a company needs roughly 8 approved
  ratings before its own average and the platform average carry equal
  weight.
- **A pure function** (`computeShrinkageScore`), taking `sampleSize`,
  `companyAvg`, `globalAvg`, and an optional `k` — no database access, no
  side effects, trivially unit-testable at every boundary.
- **Sample-size-weighted aggregation of per-company rows into a single
  platform-wide average** (`GlobalAveragesService`), computed directly
  from issue #7's materialized views rather than re-scanning every raw
  rating.

## System design approach — the formula and why it's exactly right

```typescript
const MIN_SAMPLE_SIZE = 3; // hard floor — CLAUDE.md hard constraint #3

export function computeShrinkageScore(
  sampleSize: number,
  companyAvg: number,
  globalAvg: number,
  k: number = DEFAULT_SHRINKAGE_K, // 8
): number | null {
  if (sampleSize < MIN_SAMPLE_SIZE) return null;
  return (sampleSize / (sampleSize + k)) * companyAvg + (k / (sampleSize + k)) * globalAvg;
}
```

This function is deliberately the *only* place this formula is
implemented — every metric (difficulty, fairness, approachability,
overall experience...) across every phase's later analytics work calls
this same function, never reimplements the math inline. That matters
because a formula this easy to get subtly wrong (swap the two weight
terms, or use `n + k` in only one denominator) is exactly the kind of bug
that's cheap to introduce by copy-paste and expensive to notice, since
the output still "looks like" a plausible average either way.

**Computing the global average correctly is the less obvious half of this
issue.** The naive approach — average every company's own average — is
wrong, because it weights a company with 3 ratings exactly as heavily as
a company with 300. The correct approach, and what `GlobalAveragesService`
actually does, is a sample-size-weighted average straight off issue #7's
materialized views:

```sql
SELECT
  SUM(avg_difficulty * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_difficulty,
  -- ...
  SUM(sample_size)::int AS sample_size
FROM company_round_type_aggregates
WHERE round_type = $1
```

This is mathematically identical to averaging every individual approved
rating row directly across the whole platform
(`sum(avg_i * n_i) / sum(n_i)` is the definition of a weighted mean, and
it equals the true grand mean when each `avg_i` was itself computed over
exactly `n_i` raw rows) — but it computes that answer by reading three
small, pre-aggregated view rows per company instead of re-scanning every
raw `round_ratings` row on the whole platform for every request. Getting
the *same* correct number with dramatically less work read is the entire
point of building the materialized views in issue #7 first.

**Cold start is handled as a real case, not an edge case bolted on
after.** If there's no platform data at all yet for a given slice (a
brand-new round type nobody's ever been rated on), `GlobalAveragesService`
returns `null` rather than `0` or `NaN` — there's nothing to shrink
toward yet, and `docs/ARCHITECTURE.md`'s own "Known scale risks" section
names this exact scenario ("no candidate rates a company with zero
existing reviews") as a real launch-sequencing concern, not just a
theoretical one.

## Step-by-step: what actually got built

1. **Implemented `computeShrinkageScore()`** as a standalone pure
   function, with the hard `n < 3` floor baked in as the very first
   check.
2. **Wrote boundary-condition unit tests**: exactly at `n=3` (should
   compute), `n=2` (should be `null`), `n=0`, very large `n` (should
   converge close to `companyAvg`), `n` equal to `k` (should weight both
   averages equally) — the kind of exhaustive boundary coverage a pure,
   side-effect-free function makes cheap to write.
3. **Built `GlobalAveragesService`** with one method per aggregate grain
   (`getRoundTypeGlobalAverages(roundType)`, `getRecruiterGlobalAverages()`,
   `getOverallGlobalAverages()`), each doing the sample-size-weighted
   `SUM(avg * n) / SUM(n)` query against issue #7's views, returning
   `null` on a true cold start (zero platform-wide sample size for that
   slice).
4. **Wrote 15 unit tests** covering both the formula's boundary
   conditions and `GlobalAveragesService`'s row-parsing logic (mocked
   Prisma, since `$queryRaw` results come back as loosely-typed rows that
   need explicit `Number(...)` conversion — Postgres's `numeric` type
   round-trips through Prisma as a string, not a native number, which the
   service's parsing logic has to account for).
5. **Wrote 2 integration tests** (`global-averages.e2e-spec.ts`) against
   real multi-company data, hand-computing the expected weighted average
   and asserting the service matches it exactly — plus the true
   cold-start case (a round type with no data anywhere) returning `null`.
6. **Deliberately scoped out** the "fall back to the company-wide
   aggregate when a specific round-type slice is under the floor" nuance
   from `docs/DATA_MODEL.md` — that decision (which aggregate to feed the
   formula in the first place) belongs to issue #9, which is the actual
   consumer deciding how to assemble a response; issue #8's job was only
   the formula and the global-average inputs to it.

## What this enabled

Issue #9's analytics endpoint and issue #10's dashboard both call
`computeShrinkageScore()` directly, for every metric, without
reimplementing or second-guessing the math — the formula, once correct
and well-tested here, never needed to change again through the rest of
the project. The sample-size-weighted global average technique is
independently the more broadly reusable half of this issue: any system
aggregating pre-computed per-group averages into a single overall average
needs exactly this weighting, or it silently produces a mathematically
wrong answer that happens to look plausible.
