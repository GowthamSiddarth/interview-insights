# Phase 30, Issue #332 — Wire Creation + Moderation Status-Change Events for All Three Moderated Entity Types

*Part of Phase 30 — Event-Driven Foundation. See `docs/ROADMAP.md` Phase
30, `docs/DECISIONS.md` D16/D17/D53, and `docs/EVENTS.md`.*

## The gap this closed

Issue #331 built a publisher that nothing called. This issue makes it
real: every place a `round_rating`, `recruiter_rating`, or
`overall_review` gets created, and every place `ModerationService`
decides its fate (`approve()`/`reject()`/`flag()`, including the AI
auto-approval path from Phase 39), now publishes a domain event — across
both the incremental single-create endpoints and the bulk-submission
path (Phase 25/26). Six event types × the places they fire from is a lot
of call sites; the actual design problem this issue had to solve was
*where* that publishing logic should live so it doesn't get duplicated
six-plus times.

## Key concept: centralizing event-building in `ModerationService`, not in each entity's own service

`RoundRatingsService`, `RecruiterRatingsService`, `OverallReviewsService`,
and `BulkProcessSubmissionService` are four different call sites that all
need to publish a `*.created` event after their own transaction commits.
Rather than duplicating "fetch the fresh row, join through to get
`companyId`, build the event, call `publish()`" logic in each of those
four services, all of it lives in two methods on `ModerationService`
itself — `publishCreatedEvent(entityType, entityId)` and the private
`publishStatusChangedEvent(entityType, entityId, newStatus, reviewedBy)`
— dispatched on a `ModerationEntityType` switch:

```ts
async publishCreatedEvent(entityType: ModerationEntityType, entityId: string): Promise<void> {
  try {
    const occurredAt = new Date().toISOString();
    switch (entityType) {
      case 'round_rating': {
        const r = await this.prisma.roundRating.findUniqueOrThrow({
          where: { id: entityId },
          include: { round: { include: { process: true } } },
        });
        const event: RoundRatingCreatedEventV1 = {
          eventType: 'moderation.round_rating.created',
          eventVersion: 1,
          occurredAt,
          roundRatingId: r.id,
          roundId: r.roundId,
          candidateId: r.candidateId,
          companyId: r.round.process.companyId,
          status: 'pending',
        };
        await this.domainEventPublisher.publish(ROUND_RATING_CREATED_V1_TOPIC, event, r.id);
        return;
      }
      // ...recruiter_rating, overall_review, company (no-op) cases
    }
  } catch (err) {
    this.logger.error(`Failed to publish created event for ${entityType} ${entityId}`, err instanceof Error ? err.stack : err);
  }
}
```

This mirrors a decision this codebase already made once before, for a
different derived write:
`ModerationService.indexForSearch(entityType, entityId)` (Phase 35, issue
#370) centralizes OpenSearch indexing the exact same way, for the exact
same reason — one place owns "how do I turn this entity type into its
derived representation," and every caller just passes an entity type and
id. `RoundRatingsService.create()` now calls both, back to back, after
its own transaction commits:

```ts
await this.moderationService.indexForSearch('round_rating', rating.id);
await this.moderationService.publishCreatedEvent('round_rating', rating.id);
```

## Key concept: fetching fresh from Postgres, not trusting caller context

Every branch of `publishCreatedEvent`/`publishStatusChangedEvent`
re-fetches the entity from Postgres (with the joins needed to reach
`companyId`) rather than accepting an already-loaded object from the
caller. This looks like wasted work — the caller usually just created or
updated this exact row — but it's the same reasoning `indexForSearch()`
already established: building the event fresh from the entity type + id
keeps this method correct no matter which context calls it, including
ones (like the bulk-submission path, which creates several different
entity types in one request) that don't have every join handy in scope
at the call site. A method whose contract is "give me a type and an id
and I'll do the rest" is safe to call from anywhere, forever, without
auditing what each caller happens to have loaded.

## Key concept: `status_changed` events carry a `previousStatus` that's always `'pending'` — and why that's not a bug

```ts
const event: RoundRatingStatusChangedEventV1 = {
  // ...
  previousStatus: 'pending',
  newStatus,
  reviewedBy,
};
```

This looks suspicious at first glance — why hardcode `previousStatus`
instead of fetching the entity's actual prior state? Because
`ModerationService.review()` (the shared implementation behind
`approve()`/`reject()`/`flag()`, and `approveWithAudit()`, Phase 39's
AI auto-approval entry point) only ever runs against an entity that's
still `pending` — CLAUDE.md hard constraint #2 guarantees every
rating/review starts `pending` and this project has no re-review path.
So `previousStatus: 'pending'` isn't a shortcut that happens to work
today; it's an invariant of the one code path that calls this method,
documented in the type itself rather than left implicit.

## Step-by-step: what actually got built and verified

1. Added `publishCreatedEvent()` and `publishStatusChangedEvent()` to
   `ModerationService`, dispatching across the three entity types (plus
   a deliberate `company` no-op case).
2. Called `publishCreatedEvent()` from `RoundRatingsService.create()`,
   `RecruiterRatingsService.create()`, `OverallReviewsService.create()`,
   and once per entity created inside
   `BulkProcessSubmissionService.create()` — always immediately after
   `indexForSearch()`, always after the owning transaction has already
   committed.
3. Called `publishStatusChangedEvent()` from inside `review()`, so it
   fires uniformly for every decision path including the AI
   auto-approval route added in Phase 39.
4. `EventsModule` imported into `ModerationModule` — the first module
   that actually depends on it — which is what makes `AppModule` connect
   to Redpanda at boot at all, for the first time in this project.
5. `docs/EVENTS.md` updated from "the plumbing exists" to "here's every
   call site that uses it."
6. `api/test/domain-events.e2e-spec.ts` — real end-to-end coverage using
   a fresh Kafka consumer per assertion (`api/test/support/redpanda.ts`'s
   `waitForEvent()`, mirroring the "needs a real instance, not a mock"
   philosophy `test/support/mailpit.ts` already established for email in
   Phase 16/D29): create a round rating, consume the real topic, assert
   the event landed with the right shape; approve it, consume the
   `status_changed` topic, assert `previousStatus`/`newStatus` are
   correct.

## What this enabled

`AppModule` now genuinely produces to Redpanda at boot, on real write
paths, in every environment including CI. Nothing consumes any of these
six topics yet — Phase 31 (notification-service) and Phase 32
(review-analyzer) are the two consumers this plumbing exists for. One
real gap did surface during design review right after this issue merged,
covered in the next post: what happens if the broker connection drops,
or was never established at boot, and never comes back on its own.
