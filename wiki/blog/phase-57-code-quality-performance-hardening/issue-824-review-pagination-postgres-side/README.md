# Phase 57, Issue #824 — findApprovedReviews Loads All Rows Then Paginates in Memory

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57, GitHub issues #315/#347/#823, #781.*

## The gap

`CompaniesService.findApprovedReviews()` — the query behind a company
profile page's reviews list — loaded every approved rating for the
company, grouped them by `InterviewProcess` in application memory
(#347's grouping fix), and only *then* sliced off the requested page.
A real `page`/`pageSize` contract existed on the response shape, but
nothing about the actual query respected it — a popular company paid
the full query/serialization/grouping cost on every single page
request, not just page 1. Originally deferred rather than fixed
alongside #823 — the correct fix needed a real design decision (a
window-function query, or a materialized view like the aggregation
layer already uses), not a quick patch, and #823 had already
established the same "row-level `LIMIT`/`OFFSET` would split a
submission's rounds across a page boundary" constraint applied here
too.

## The fix: rank processes in Postgres, then fetch only that page's rows

Two queries. The first ranks each `InterviewProcess` by its most recent
approved rating and returns only the requested page's process ids —
grouping still has to happen at the process level, not the row level,
for the same #315/#347 reason #823 already established:

```ts
const [totalRows, pageRows] = await Promise.all([
  this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT r."process_id") AS count
    FROM "round_ratings" rr
    JOIN "rounds" r ON r."id" = rr."round_id"
    JOIN "interview_processes" ip ON ip."id" = r."process_id"
    WHERE ip."company_id" = ${companyId}::uuid AND rr."status" = 'approved'
  `),
  this.prisma.$queryRaw<{ process_id: string }[]>(Prisma.sql`
    SELECT r."process_id" AS process_id
    FROM "round_ratings" rr
    JOIN "rounds" r ON r."id" = rr."round_id"
    JOIN "interview_processes" ip ON ip."id" = r."process_id"
    WHERE ip."company_id" = ${companyId}::uuid AND rr."status" = 'approved'
    GROUP BY r."process_id"
    ORDER BY MAX(rr."created_at") DESC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `),
]);
```

The total count runs as its own separate, unbounded query rather than a
`COUNT(*) OVER()` window on the paginated query — a window function's
count only reflects rows that survive the `LIMIT`, so an out-of-range
page (say, page 3 of a company with only 2 pages of reviews) would
otherwise report a wrong, zeroed-out total instead of the real one.

The second query then fetches full rating rows for just that page's
(bounded) set of processes and groups them in memory exactly as
before — but now bounded to a handful of processes, not the company's
entire history:

```ts
const ratings = await this.prisma.roundRating.findMany({
  where: { status: 'approved', round: { processId: { in: processIds } } },
  orderBy: { createdAt: 'desc' },
  include: { round: { select: { title: true, roundType: true, processId: true, process: { select: { roleTitle: true } } } } },
});
```

One subtlety worth naming: the second query's row-level `createdAt`
ordering across multiple processes doesn't guarantee group-level order
matches the first query's own `MAX(created_at)` ranking exactly — a
process whose single most-recent rating is older than another process's
*second*-most-recent rating could sort differently. The final `items`
are explicitly re-ordered to match the first query's process order, not
trusted to fall out correctly from the second query's row order.

Only values are ever interpolated into these queries — `companyId`,
`pageSize`, the computed offset — never table or column identifiers,
the same injection-safe shape #781 (Phase 52) already established for
this app's other raw SQL.

## Verification

Rewrote all of `findApprovedReviews`'s unit test coverage around the
new two-query shape: the ranking query's exact SQL text and bound
values, the empty-page-without-querying-rows case, grouping multiple
ratings under one process, multi-process ordering, pagination across
two pages, and a dedicated test constructing the exact scenario the
re-ordering fix protects against (a second process's row arriving first
from the row-level query despite being ranked second by the process-level
query). Also verified live against real Postgres via the existing
`company-reviews.e2e-spec.ts` in CI — this app's own local dev
environment hit infra flakiness unrelated to the change itself, so CI's
clean, isolated service containers were the actual proof this worked
end to end, not just against mocks.
