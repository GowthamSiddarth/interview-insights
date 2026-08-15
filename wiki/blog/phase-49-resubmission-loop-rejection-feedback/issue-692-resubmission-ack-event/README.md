# Phase 49, Issue #692 — Publish a Resubmission-Ack Event on `reenqueue()`

*Part of Phase 49 — Resubmission Loop & Rejection Feedback.
See `docs/ROADMAP.md` Phase 49, D104.*

## The gap

Unlike `create()`, `update()` never called `publishCreatedEvent()` — a
candidate who resubmitted after an edit got no acknowledgment at all
until the eventual decision, and `review-analyzer`'s re-triage of the
edited content (its `moderationVerdict` reset to `null` on every edit)
only happened via its 24h reconciliation-sweep window instead of
immediately, since nothing re-fired the `*.created`-shaped event its
consumer subscribes to.

## The fix: reuse `*.created`, don't invent a new event type

Two options existed: a brand-new `*.resubmitted.v1` event type, or an
`isResubmission` flag on the existing `*.created.v1` schemas. The
simpler option won — it reuses `notification-service`'s existing
pending-review template (with an adjusted subject line) instead of a
parallel code path:

```ts
async publishCreatedEvent(
  entityType: ModerationEntityType,
  entityId: string,
  resubmission?: { moderationQueueEntryId: string },
): Promise<void> {
  const isResubmission = resubmission !== undefined;
  const moderationQueueEntryId = resubmission?.moderationQueueEntryId;
  // ...event object gains isResubmission, moderationQueueEntryId
}
```

Each write-path service's `update()` now captures `reenqueue()`'s
return value and calls this after the transaction commits, same
best-effort/after-commit shape `create()` already used:

```ts
const result = await this.prisma.$transaction(async (tx) => {
  const updated = await tx.roundRating.update({ /* ... */ });
  const queueEntry = await this.moderationService.reenqueue('round_rating', id, tx);
  return { updated, queueEntry };
});
await this.moderationService.indexForSearch('round_rating', id);
await this.moderationService.publishCreatedEvent('round_rating', id, {
  moderationQueueEntryId: result.queueEntry.id,
});
```

On the consumer side, this reopened exactly the class of bug #687 had
just fixed on the `status_changed` side: a `created` event's dedup key
was hardcoded to an empty string on the reasoning that a `created` event
"only ever fires once per entity." That's no longer true once
resubmission reuses the same event shape. The fix mirrors #687's own —
key a *resubmission* `created` event by its fresh queue entry id instead:

```ts
function moderationQueueEntryIdFor(event: ModerationEvent): string {
  if (isStatusChangedEvent(event)) return event.moderationQueueEntryId ?? '';
  if (isCreatedEvent(event) && event.isResubmission) return event.moderationQueueEntryId ?? '';
  return '';
}
```

This can never collide with the original submission's already-sent
dedup row (still keyed `''`), since a real queue entry id is never the
empty string. `pendingReviewSubjectAndBody(isResubmission)` picks
between "Your submission is pending review" and "Your edited submission
is back in review."

## Verification

A dedicated regression test in `notification-consumer.service.spec.ts`
mocks `NotificationLog.findUnique` to only match the *original*
submission's dedup key, proving the resubmission ack still sends despite
that collision risk existing in principle. A real-Redpanda e2e case in
`api/test/domain-events.e2e-spec.ts` drives an actual reject → resubmit
cycle and waits for a second `created.v1` event marked
`isResubmission: true`; a real-Mailpit e2e case in
`notification-service` proves the distinct "back in review" email
actually lands as a second message, not a swallowed duplicate.
