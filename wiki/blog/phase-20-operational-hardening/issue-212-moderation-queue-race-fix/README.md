# Phase 20, Issue #212 — `GET /moderation/queue` Isolates Each Entity Type's Enrichment

*Part of Phase 20 — Operational Hardening & Live-Verification Findings.
Surfaced while stress-testing issue #216's golden-path smoke test. See
`docs/ROADMAP.md` Phase 20 and `docs/DECISIONS.md` D37.*

## Why this is a genuinely interesting bug, not just a flaky test

Stress-testing the full e2e suite repeatedly (to prove issue #216's new
smoke test wasn't itself flaky) surfaced an intermittent `500` on `GET
/moderation/queue` — but never in the same test file twice. Different,
completely unrelated tests failed each run: `analytics`,
`recruiter-ratings`, `moderation`, `sessions-on-write-path`,
`overall-reviews`, `me-submissions`, `review-search`,
`update-delete-moderated-content` all took a turn. Every one of those
files is an innocent bystander — the actual failure is always inside
`findQueueEntryFor()`'s call to the moderation queue endpoint.

## Key concept: ruling out the obvious guesses, both of them wrong

The two "usual suspect" explanations for this class of flake were both
tested directly, and both ruled out:

**Jest's default worker parallelism?** Reproduced identically under
`--runInBand` — fully serial, one test file at a time, zero
parallelism. Not concurrency between files.

**Accumulated test-database volume?** Reproduced just as often — often
*more* often — against a freshly truncated `interview_insights_test`.
Not leftover data from prior runs either.

## Key concept: confirming a durable orphan is actually impossible

The server log during a failure showed:

```
PrismaClientUnknownRequestError: Inconsistent query result:
Field process is required to return data, got `null` instead.
```

This *looks* like a `RecruiterInteraction` pointing at a deleted
`InterviewProcess` — a durable orphaned row. Before chasing that
theory, it was checked directly against the live schema:

```sql
FOREIGN KEY (process_id) REFERENCES interview_processes(id)
  ON UPDATE CASCADE ON DELETE RESTRICT
```

A real, Postgres-enforced constraint with `ON DELETE RESTRICT`.
Postgres would reject any delete that left this row orphaned — a
durable inconsistency is structurally impossible here. Whatever Prisma
was seeing, it wasn't a bad row sitting in the database.

## Key concept: a query-time race, not a data-integrity bug

`ModerationService.listPending()` enriches unreviewed queue entries via
a required-relation `include` three levels deep
(`recruiterRating -> recruiterInteraction -> process -> company`).
Prisma splits a nested `include` this deep across multiple separate
round trips to Postgres rather than reading one atomic snapshot. If a
*concurrent* transaction — a GDPR erasure (issue #151) or an
Update/Delete (issue #150) delete, both of which legitimately delete
`RecruiterInteraction`/`InterviewProcess` rows — commits *between*
`listPending()`'s own round trips, the second round trip can find
nothing for a `processId` the first round trip already captured a
reference to moments earlier. A required relation can't return null
gracefully, so Prisma throws instead.

## Key concept: the real bug was the blast radius, not the race itself

```ts
const [roundRatings, recruiterRatings, overallReviews] = await Promise.all([
  this.prisma.roundRating.findMany({ /* ... */ }),
  this.prisma.recruiterRating.findMany({ /* ... */ }),
  this.prisma.overallReview.findMany({ /* ... */ }),
]);
```

`Promise.all` meant one entity type's transient failure rejected the
*entire* call — crashing `GET /moderation/queue` for every caller,
regardless of what they actually needed from it. That's the real
explanation for why the failure kept jumping to unrelated test files:
it's a single shared, global endpoint, and any concurrently-running
erasure/delete anywhere in the suite could poison it for everyone at
that instant, independent of what that particular test was checking.

## System design approach

```ts
const [roundRatingsResult, recruiterRatingsResult, overallReviewsResult] =
  await Promise.allSettled([ /* the same three queries */ ]);

const roundRatings = this.settledOrEmpty(roundRatingsResult, 'round_rating');
const recruiterRatings = this.settledOrEmpty(recruiterRatingsResult, 'recruiter_rating');
const overallReviews = this.settledOrEmpty(overallReviewsResult, 'overall_review');
```

`settledOrEmpty()` logs the failure (`this.logger.error`) and degrades
to an empty array — that entity type's entries simply get
`entity: null`, the exact same graceful fallback the endpoint already
used for a genuinely missing underlying row. One entity type
transiently failing no longer affects the other two, and never crashes
the endpoint outright.

This deliberately does **not** eliminate the underlying race — a
deeper fix would mean making the multi-query read fully
snapshot-consistent (a serializable transaction around the whole
read). Making an admin-facing read path resilient to an unrelated
concurrent write elsewhere in the system was the right scope here, not
chasing full isolation for a read that's inherently a point-in-time
snapshot anyway.

## Step-by-step: what actually got diagnosed and verified

1. Reproduced the failure via repeated full-suite runs, then narrowed
   the reproduction: `--runInBand` (ruled out concurrency), a freshly
   truncated test DB (ruled out data volume).
2. Confirmed the FK constraint directly against the live schema via
   `pg_constraint` — ruled out a durable orphan.
3. Traced the actual mechanism to Prisma's multi-round-trip nested
   `include` behavior colliding with a concurrent erasure/delete.
4. Implemented `Promise.allSettled` + `settledOrEmpty()`, with a new
   unit test simulating one entity type's query rejecting — confirms
   the other two still enrich correctly and the failing type's entries
   get `entity: null`.
5. Stress-verified 8+ consecutive full-suite runs against a freshly
   truncated database, both before and after the fix. Before:
   intermittent failures matching this exact signature. After: the
   underlying transient Prisma error still fires and logs (confirmed
   directly in server output across two separate runs) — but zero test
   failures resulted from it in any run.

## What this enabled — and what stayed explicitly out of scope

A moderation queue that degrades gracefully under a real, if rare,
concurrency condition instead of hard-failing for every caller. A
separate, unrelated intermittent failure (`Parse Error: Expected
HTTP/`, seen in `fraud-checks`/`recruiter-ratings`) was also observed
during this investigation and stayed explicitly out of scope — flagged
for its own future investigation rather than chased down here, since
conflating two different flake signatures in one fix would have made
both harder to verify cleanly.
