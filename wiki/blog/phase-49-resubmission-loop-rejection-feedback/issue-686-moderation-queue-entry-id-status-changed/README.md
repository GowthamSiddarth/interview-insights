# Phase 49, Issue #686 — Add `moderationQueueEntryId` to `*.status_changed.v1` Events

*Part of Phase 49 — Resubmission Loop & Rejection Feedback.
See `docs/ROADMAP.md` Phase 49, D104.*

## The gap this closed

Phase 49 was filed from an end-to-end audit of this project's
notification/communication chains (D104). The headline finding: a
candidate who edits a rejected or flagged rating gets re-enqueued
(`ModerationService.reenqueue()`) into a *fresh* `ModerationQueueEntry`
row — the entity's own id never changes, but the queue entry that
decision was made against does. `notification-service`'s
`NotificationLog` idempotency key, though, was just
`entityType + entityId + eventType`. That key can't tell "already
notified about *this* decision" apart from "notified about a *previous*
decision on the same entity" — so once a candidate had been notified
once about a `round_rating.status_changed` event, every later one on the
same `roundRatingId` looked like an already-handled duplicate and got
silently skipped.

Fixing the actual dedup key is #687. This issue is scoped narrower on
purpose: get the raw data the fix needs — the deciding queue entry's own
id — onto the event in the first place, as a standalone, low-risk,
backward-compatible schema change.

## The fix

An optional field on all three `*.status_changed.v1` event interfaces,
in both `api`'s producer copy and `notification-service`'s duplicated
consumer copy (the D73/D75 duplicate-rather-than-share convention this
project already uses for cross-service event contracts):

```ts
export interface RoundRatingStatusChangedEventV1 {
  eventType: 'moderation.round_rating.status_changed';
  eventVersion: 1;
  occurredAt: string;
  roundRatingId: string;
  roundId: string;
  candidateId: string;
  companyId: string;
  previousStatus: 'pending';
  newStatus: ModerationStatus;
  reviewedBy?: string;
  // GitHub issue #686 — optional, non-breaking addition to the existing
  // v1 contract per docs/EVENTS.md — no version bump needed.
  moderationQueueEntryId?: string;
}
```

Optional rather than required matters here: docs/EVENTS.md's own
versioning convention allows a new optional field to land on an existing
`v1` type in place, with every consumer continuing to work unchanged
until it's ready to read the new field. A breaking shape change would
have forced a `v2` topic and a migration window for every consumer.

`ModerationService.publishStatusChangedEvent()` — the one place all
three event types get built — already takes the deciding
`moderationQueueEntryId` as a parameter (threaded in from `review()`,
which has the queue entry's own `id` in scope the whole time). The only
change needed was actually putting that value on the event object
instead of just using it for the method's own internal bookkeeping:

```ts
private async publishStatusChangedEvent(
  entityType: ModerationEntityType,
  entityId: string,
  newStatus: ModerationStatus,
  reviewedBy: string | undefined,
  moderationQueueEntryId: string,
): Promise<void> {
  // ...
  const event: RoundRatingStatusChangedEventV1 = {
    eventType: 'moderation.round_rating.status_changed',
    eventVersion: 1,
    occurredAt,
    roundRatingId: r.id,
    roundId: r.roundId,
    candidateId: r.candidateId,
    companyId: r.round.process.companyId,
    previousStatus: 'pending',
    newStatus,
    reviewedBy,
    moderationQueueEntryId,
  };
  // ...
}
```

## Verification

Unit tests in `moderation.service.spec.ts` were extended to assert the
published event object includes `moderationQueueEntryId` matching the
queue entry id that was actually reviewed — for all three entity types,
since each has its own event-building branch in the switch statement.
`notification-service`'s own consumer wasn't touched by this issue at
all; it doesn't read the new field yet (that's #687), so its existing
test suite passed unchanged, proving the addition really is
non-breaking.
