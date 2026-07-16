# Phase 4, Issue #9 — `GET /companies/:companyId/analytics`

*Part of Phase 4 — Analytics. See `docs/ROADMAP.md` Phase 4, `docs/DATA_MODEL.md` D4.*

## Why this came first

Issues #7 and #8 built the aggregation views and the shrinkage-scoring
formula, but neither was reachable over HTTP yet. Issue #9's job was to
wire them together into a single public endpoint — the first point where
this phase's work becomes something the frontend (issue #10) can actually
call.

## Key concepts

- **Assemble, don't recompute.** This endpoint's whole job is
  composition: read issue #7's three materialized views for one company,
  feed each row through issue #8's `computeShrinkageScore()` against the
  matching global average, and shape the result. No new aggregation
  logic, no new statistics — every hard part was already solved by the
  two issues before it. This is what "plan the whole phase before
  implementing any of it" actually buys: by the time issue #9 starts, its
  two dependencies are already correct and independently tested, so this
  issue is pure wiring, with a correspondingly small risk of introducing
  a new bug.
- **Always return `sample_size`, even when the score is `null`.** This is
  D4's transparency principle showing up directly in the response shape,
  not just the dashboard's rendering: every metric object is
  `{ score, sampleSize }`, never just `score`. A `null` score with
  `sampleSize: 2` tells the frontend (and any future API consumer) *why*
  there's no number — genuinely too little data — as opposed to a bug
  that silently dropped the score. Hiding `sampleSize` whenever `score`
  is `null` would make those two situations indistinguishable from the
  outside.
- **Absence at different levels means different things, and the endpoint
  is careful to keep them distinct.** A round type the company has never
  been rated on doesn't appear in `roundTypes` at all (issue #7's view
  itself has no row for a zero-sample group — see that post). But
  `recruiter`/`overall` are explicit `null` fields on the response object,
  not simply missing keys, when the company has zero rows in those views
  — a deliberate choice so a frontend doesn't need three different
  "is this data present" checks for three conceptually similar cases.
- **A documented scope boundary, carried forward from the issue before
  it.** `docs/DATA_MODEL.md` describes falling back to a company-wide
  aggregate when a specific round-type slice is under the shrinkage
  floor. This endpoint explicitly does *not* implement that — the code
  comment says so directly, and gives the actual reason: it's not
  required by this issue's acceptance criteria, and it adds a real new
  kind of complexity (a second grain of "company-wide, collapsed across
  round types" to compute and clearly label) without any evidence yet
  that real usage needs it. Deferred, not forgotten — revisit once the
  dashboard or real usage shows it matters.

## Core technologies

- **Prisma's `$queryRaw` tagged-template function**, used here instead of
  Prisma's normal query builder — because the three source tables
  (`company_round_type_aggregates`, etc.) are raw SQL materialized views
  from issue #7, not modeled in `schema.prisma` at all (see that post's
  explanation of why Prisma can't manage views as first-class models).
  `$queryRaw` is parameterized (`WHERE company_id = ${companyId}::uuid`),
  so this is not raw string concatenation — Prisma still protects against
  SQL injection here exactly as it does for its normal query builder.
- **`Promise.all` for the round-type loop**, since a company can have
  ratings across multiple round types (`coding`, `behavioral`, ...) and
  each one independently needs its own shrinkage-scored metrics computed
  — running these concurrently rather than sequentially is a small,
  free win once the underlying calls are already async.

## System design approach

The service's shape mirrors the three source views exactly — one query
per view, one "build the response shape for this row" helper per query,
each helper calling `GlobalAveragesService` for the matching slice and
running every one of that row's metrics through
`computeShrinkageScore()`:

```typescript
async getCompanyAnalytics(companyId: string): Promise<CompanyAnalytics> {
  await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }); // 404 via P2025

  const roundTypeRows = await this.prisma.$queryRaw<CompanyRoundTypeRow[]>`
    SELECT round_type, avg_difficulty, /* ... */, sample_size
    FROM company_round_type_aggregates WHERE company_id = ${companyId}::uuid
  `;
  const roundTypes = await Promise.all(
    roundTypeRows.map((row) => this.buildRoundTypeAnalytics(row)),
  );
  // ...same shape for recruiterRows and overallRows...

  return { companyId, roundTypes, recruiter, overall };
}
```

`buildRoundTypeAnalytics` is where issue #8's formula actually gets
called, once per metric, each against its own matching global average:

```typescript
private async buildRoundTypeAnalytics(row: CompanyRoundTypeRow): Promise<RoundTypeAnalytics> {
  const globalAverages = await this.globalAveragesService.getRoundTypeGlobalAverages(row.round_type);
  const n = row.sample_size;
  const score = (companyAvg: string, metric: keyof RoundTypeGlobalAverages) =>
    globalAverages ? computeShrinkageScore(n, Number(companyAvg), globalAverages[metric]) : null;

  return {
    roundType: row.round_type,
    sampleSize: n,
    scores: {
      difficulty: score(row.avg_difficulty, 'avgDifficulty'),
      fairness: score(row.avg_fairness, 'avgFairness'),
      // ...
    },
  };
}
```

Note the `globalAverages ? ... : null` guard — if there's genuinely no
platform-wide data yet for this round type (issue #8's cold-start case),
there's nothing to shrink toward, so every metric for that round type
comes back `null` regardless of the company's own `sample_size`. This is
a real, if unlikely, edge case worth naming explicitly: a company could
have plenty of its *own* ratings for a round type nobody else on the
platform has ever been rated on — `n` above the floor, but still no
sensible shrunk score to show, because shrinkage fundamentally needs
*something* to shrink toward.

`Company.findUniqueOrThrow` at the top of the method is doing double
duty: it both validates the company exists and, via `PrismaExceptionFilter`
(Phase 2.1), turns a nonexistent company into a clean `404` without any
explicit `if (!company) throw ...` in this service at all — the same
shared exception-mapping infrastructure built two phases earlier, reused
here without modification.

## Step-by-step: what actually got built

1. **Built `AnalyticsService.getCompanyAnalytics()`**, querying all three
   materialized views for one company via `$queryRaw`, and a
   per-view-row builder method (`buildRoundTypeAnalytics`,
   `buildRecruiterAnalytics`, `buildOverallAnalytics`) that calls
   `GlobalAveragesService` + `computeShrinkageScore()` for every metric.
2. **Built `AnalyticsController`** at `GET /companies/:companyId/
   analytics`, and wired `AnalyticsModule` into `AppModule` for the first
   time (issue #8 had no controller, so the module existed but wasn't
   reachable over HTTP until now).
3. **Wrote 5 unit tests** (mocked Prisma + `GlobalAveragesService`)
   covering the response-shaping logic independent of a real database.
4. **Wrote 5 integration tests** (`analytics.e2e-spec.ts`) against a real
   Postgres: a hand-recomputed shrinkage value (seed known ratings,
   independently compute the expected shrunk score by hand, assert the
   endpoint matches exactly), the null-with-real-`sample_size` case, an
   empty response for a company with zero ratings anywhere, and the
   404/400 error paths.
5. **Manually verified the full loop end to end** — booted `api` against
   the real Docker Postgres, drove actual HTTP calls through
   write → moderation-approve → refresh-view → analytics-read via `curl`,
   and confirmed the returned score matched the shrinkage formula's
   expected pull toward the platform-wide average. This is the same
   "don't trust automated tests alone — drive the real thing once too"
   discipline established in Phase 2.3, now applied to a backend-only
   feature via `curl` instead of a browser, since there's no UI yet at
   this point in the phase.

## What this enabled

Issue #10's dashboard is a thin rendering layer directly on top of this
one endpoint's response shape — no further backend work was needed once
this issue shipped. The endpoint's `{ score, sampleSize }` pairing at
every level of the response is also what let issue #10's `ScoreDisplay`
component implement CLAUDE.md's hard constraint #3 (never show a raw
score below the floor) as a single, reusable rendering rule, rather than
special-casing each of the eleven scores the dashboard eventually shows.
