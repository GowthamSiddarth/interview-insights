# Phase 14, Issue #126 — OverallReview Write Path

*Part of Phase 14 — Recruiter & Overall Reviews + Moderation Admin UI.
Implemented right after issue #125 since both extend the same
`ModerationService.review()` method. See `docs/ROADMAP.md` Phase 14.*

## Why this came second

Same gap as issue #125, last remaining instance: `overall_reviews` had
schema, a `UNIQUE(process_id)` constraint, and a permanently empty
`company_overall_aggregates` materialized view — and nothing that could
ever write a row. Doing it immediately after the recruiter-rating issue
meant the two changes to `ModerationService.review()` landed as
consecutive, non-conflicting PRs instead of two branches editing
adjacent lines of the same method.

## Key concept: let the schema do the enforcement

An overall review is one-per-process by design (`docs/DATA_MODEL.md`).
The temptation is to enforce that in the service — check for an
existing review, throw a 409. That's a read-then-write race, and it
duplicates something the database already guarantees: the
`UNIQUE(process_id)` constraint has existed since Phase 1's first
migration. So `OverallReviewsService.create()` just inserts; a
duplicate submission surfaces as Prisma's `P2002`, which the Phase 2
`PrismaExceptionFilter` already maps to a 409 with a readable message.
Zero app logic, zero race window, and the e2e test proves the behavior
end to end. The same reasoning shaped the route: `POST
/processes/:processId/overall-review` — singular resource, not a
`/overall-reviews` collection, because the URL should say what the
constraint says.

## Key concept: a guard should die when it has nothing left to guard

Since Phase 3, `ModerationService.review()` opened with a guard:
anything that wasn't a `round_rating` threw `NotImplementedException`.
Issue #125 narrowed it; this issue deleted it. With all three
`ModerationEntityType` values now having real write paths, the status
flip became an exhaustive `switch` over the enum:

```ts
const statusUpdate = { where: { id: entry.entityId }, data: { status: decision } };
switch (entry.entityType) {
  case 'round_rating':
    await tx.roundRating.update(statusUpdate);
    break;
  case 'recruiter_rating':
    await tx.recruiterRating.update(statusUpdate);
    break;
  case 'overall_review':
    await tx.overallReview.update(statusUpdate);
    break;
}
```

No `default` clause — TypeScript's exhaustiveness checking over the
Prisma enum means a future fourth entity type fails the *build*, not a
runtime request. The unit test that had asserted the
`NotImplementedException` was deleted rather than kept as a fossil;
`overall_review` got the same approve/reject coverage the other two
types already had.

## System design approach

One new module, the smallest of the phase:

```
overall-reviews/     # POST /processes/:processId/overall-review
                     # GET  /processes/:processId/overall-review (approved only)
```

Same transaction shape as every other write path (create + enqueue
`pending`, hard constraint #2). The public GET is a `findFirst` on
`(processId, status: 'approved')` — singular by construction, returning
the review or an empty response while it's pending/rejected/absent.
No migration: the table and constraint were already eight months old.
Fraud checks and search indexing stayed out of scope, same reasoning
as #125.

## Step-by-step: what actually got built

1. **DTO + service + controller + module**, wired into `AppModule` —
   deliberately boring, the whole point being that the third instance
   of a pattern should be an exercise in copying decisions, not making
   them.
2. **The moderation switch** replacing the guard, with the spec updated
   to cover `overall_review` transitions and the obsolete
   NotImplemented test removed.
3. **7 e2e tests** (`overall-reviews.e2e-spec.ts`): pending → enqueued
   (`entityType: overall_review`) → approve → visible via the public
   GET; reject stays hidden; empty public read while pending; duplicate
   per process 409; non-existent process 422 (FK violation, same
   behavior as round ratings); invalid payload 400.
4. **First issue verified under the D24 workflow** — the e2e suite ran
   against kind's Postgres through a port-forward, targeting the
   isolated `interview_insights_test` database, and the live curl
   golden path's final check queried `postgres-0` directly via
   `kubectl exec` psql: no host-level port ambiguity possible, the
   exact failure mode D24 exists to prevent.

## What this enabled

Every entity in the core hierarchy — `RoundRating`,
`RecruiterRating`, `OverallReview` — now has a complete write path:
moderation-gated at creation, status-flipped by the same review
transaction, readable publicly only once approved. All three Phase 4
materialized views can accumulate real data, which means the analytics
dashboard's three sections are all finally *reachable* rather than
two-thirds decorative. What was still missing was any way to submit
these from the UI (issue #127) and any way to moderate them without
curl (issue #128).
