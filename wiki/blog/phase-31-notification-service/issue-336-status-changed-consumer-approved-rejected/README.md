# Phase 31, Issue #336 — Extending the Consumer: `*.status_changed` Events → Approved/Rejected Email

*Part of Phase 31 — Notification Service. See `docs/ROADMAP.md` Phase 31,
`docs/DECISIONS.md` D79, and `docs/EVENTS.md`.*

## The gap this closed

Issue #335 built the first real consumer, but it only ever heard half of
what `ModerationService` publishes — the `*.created` topics, not the
`*.status_changed` ones a moderator's approve/reject/flag decision fires.
A candidate who submitted a rating got a "pending review" email and then
silence, forever, regardless of the outcome. This issue closes that: the
same consumer now also subscribes to all three
`moderation.*.status_changed.v1` topics and sends an approved or rejected
email.

## Key concept: extend the existing consumer, don't stand up a second one

Every consumer group gets its own independent copy of every message —
that's what would make a *second* consumer group a legitimate option
here. But this isn't Phase 32's review-analyzer situation (a genuinely
separate service with its own concerns); it's the same
`notification-service`, doing the same kind of thing — turning a
moderation event into an email — for a second event family. `TOPICS`
just grew from three entries to six, and the same idempotency plumbing,
the same decrypt-and-send path, the same `NotificationLog` table cover
both:

```ts
const TOPICS = [
  ROUND_RATING_CREATED_V1_TOPIC,
  RECRUITER_RATING_CREATED_V1_TOPIC,
  OVERALL_REVIEW_CREATED_V1_TOPIC,
  ROUND_RATING_STATUS_CHANGED_V1_TOPIC,
  RECRUITER_RATING_STATUS_CHANGED_V1_TOPIC,
  OVERALL_REVIEW_STATUS_CHANGED_V1_TOPIC,
];
```

`entityTypeFor()`/`entityIdFor()` — already switches over `event.eventType`
— just grew a second `case` per entity type, falling through to the same
return as its `.created` sibling:

```ts
function entityIdFor(event: ModerationEvent): string {
  switch (event.eventType) {
    case 'moderation.round_rating.created':
    case 'moderation.round_rating.status_changed':
      return event.roundRatingId;
    // ...
  }
}
```

The `NotificationLog` unique constraint is `(entityType, entityId,
eventType)` — since `eventType` is `'moderation.round_rating.status_changed'`,
a distinct string from `'moderation.round_rating.created'`, both a
pending-review email and a later approved email can be logged for the
same entity without colliding. No new migration was needed for this
issue at all; the table Phase 335 already created was general enough.

## Key concept (D79): `newStatus: 'flagged'` is a real third case the type system forces you to handle

`newStatus` is typed as the full `ModerationStatus` enum — `pending |
approved | rejected | flagged` — not just the two outcomes issue #336's
own title mentions. The issue and `docs/ROADMAP.md` both only say
"approved/rejected notification"; neither says what a `flagged` decision
should do. Before writing any code, the actual invariant that makes this
safe to treat as a pure no-op had to be verified, not assumed — checked
directly against `ModerationService.review()`:

```ts
if (entry.reviewedAt) {
  throw new ConflictException('This item has already been reviewed.');
}
```

A review is one-shot. `flagged` is exactly as terminal as `approved` or
`rejected` — there is no re-review path that could ever produce a second
`status_changed` event for the same entity. That's what makes it safe to
skip not just the email, but the `NotificationLog` write too: with no
side effect to guard, idempotency has nothing to protect here.

```ts
const notification = notificationFor(event);
if (!notification) {
  // 'flagged' — no email, no NotificationLog row. Verified safe because
  // review() rejects re-reviewing an already-reviewed entry.
  return;
}
```

The alternative considered and rejected: logging the row anyway, as a
general "we saw this and chose not to notify" audit trail. Rejected
because `NotificationLog`'s whole purpose (D75) is deduping *sent*
notifications — broadening it into a general event-audit log wasn't
this issue's problem to solve, and doing so without a driving need would
just be scope creep dressed up as thoroughness.

## Step-by-step: what actually got built and verified

1. Duplicated the three `*.status_changed` event schemas
   (`round-rating`/`recruiter-rating`/`overall-review`) from `api`'s into
   `notification-service/src/events/schemas/`, same
   duplicate-rather-than-share reasoning as the `.created` ones — plus
   the `ModerationStatus` enum itself into this service's own
   `schema.prisma`, since its independently-generated Prisma client
   needed the type.
2. Extended `TOPICS`, `entityTypeFor()`/`entityIdFor()`, and
   `parseEvent()`'s recognized-event-type set to cover all six topics
   under one `ModerationEvent` union type.
3. Added `notificationFor()`: returns the pending-review template for a
   `.created` event, the approved/rejected template for a
   `.status_changed` event with a real outcome, or `null` for `flagged`
   — the one place that decides what gets sent, with `processEvent()`
   staying otherwise unchanged from #335's shape.
4. Unit tests: approved email sent + logged, rejected email sent +
   logged, flagged is a no-op (no email, no idempotency lookup, no log
   write), and a redelivered status_changed event stays a no-op the
   second time.
5. `test/notifications.e2e-spec.ts`: two new cases against the real
   stack — a real `status_changed` (approved) event lands in Mailpit
   with the right subject and dedupes on redelivery exactly like #335's
   `created` case; a real `status_changed` (flagged) event never
   produces any Mailpit message at all, so a future change to that
   no-op can't silently start emailing for it.

## What this enabled

Phase 31's full loop — submit, get a pending-review email, get reviewed,
get an outcome email — now works end to end for every moderated entity
type, on the real cluster. `notification-service` has proven the whole
broker/consumer/idempotent-side-effect pattern D53 set out to validate;
Phase 32 (review-analyzer) is next to build on the same plumbing for a
genuinely different kind of consumer.
