# Phase 36, Issue #489 — `notification-service` Consumes SLA Breach Events

*Part of Phase 36 — Moderator Queue SLAs, Assignment & Notifications. See
`docs/ROADMAP.md` Phase 36 and `docs/DECISIONS.md` D80.*

## The gap this closed

#488 publishes `moderation.queue.sla_breach.v1`; nothing consumed it.
This issue extends `notification-service`'s existing consumer (Phase 31)
to subscribe to the new topic and email the claiming moderator —
reusing the one out-of-band channel this project already has, rather
than standing up a Slack webhook or a new in-app notification center
for a single new message type.

## Key concept: a structurally different event forces a branch, not a fit

Every event `NotificationConsumerService` handled until now carried
`candidateId`, and resolved its recipient by decrypting a `Candidate`
row's email. `sla_breach` has neither — nothing about it is candidate-
facing, and its recipient is `claimedById` resolved to a `Moderator`'s
email. Squeezing it into the existing candidate-shaped logic wasn't an
option; `processEvent()` branches to a dedicated path before any of
that logic runs:

```ts
async processEvent(event: ModerationEvent): Promise<void> {
  if (event.eventType === 'moderation.queue.sla_breach') {
    return this.processSlaBreachEvent(event);
  }
  // ...unchanged candidateId-shaped logic below, never reached for this event type
}
```

`parseEvent()`'s `candidateId` guard became conditional the same way —
TypeScript's discriminated-union narrowing across the `&&` makes this
a one-line change, not a rewrite:

```ts
if (event.eventType !== 'moderation.queue.sla_breach' && !event.candidateId) {
  throw new Error('Event is missing candidateId');
}
```

## Key concept: another minimal read-only mirror, same D75 precedent

Resolving `claimedById` to an email needs a `Moderator` row —
`notification-service` has never touched that table before.
Rather than a shared client or a synchronous callback into `api`
(both already rejected, for `Candidate`, by D74/D75), it gets the same
treatment: a deliberately minimal mirror model in its own
`prisma/schema.prisma`, read-only in practice, generating its own
independent client against the same Postgres database:

```prisma
model Moderator {
  id    String @id @db.Uuid
  email String

  @@map("moderators")
}
```

No migration needed — the table already exists (#485's migration);
this is purely a typed read path against it.

## Key concept: an unclaimed breach has no recipient, and that's fine

D80's manual-claim-only assignment model means an entry can breach its
SLA while nobody has claimed it — with no auto-assignment or
distribution list, there's no principled recipient to guess at ("email
every moderator" doesn't generalize past a one-moderator system and
was never asked for). `processSlaBreachEvent()` logs and skips, the
same no-op shape the existing `'flagged'` status_changed case already
established — no email, no `NotificationLog` row, since there's no
side effect to make idempotent:

```ts
if (!event.claimedById) {
  this.logger.log(`SLA breach for queue entry ${event.queueEntryId} has no claimant — skipping (no recipient)`);
  return;
}
```

## Step-by-step: what actually got built and verified

1. Duplicated event schema (`moderation-queue-sla-breach.event.ts`,
   D73/D75's established "duplicate rather than share" pattern) —
   topic/shape must stay byte-for-byte identical to `api`'s own.
2. New minimal `Moderator` mirror model; `TOPICS`/`ModerationEvent`
   union widened; `entityTypeFor`/`entityIdFor` gained a
   `'moderation.queue.sla_breach'` case (`'moderation_queue'`/
   `queueEntryId` — the queue row itself, not the entity it wraps).
3. `processSlaBreachEvent()`: the no-claimant skip above, an
   idempotency check identical in shape to the existing consumer's own
   guard, moderator lookup, `MailService.send()`, then a
   `NotificationLog` row keyed the same way.
4. New `seed-moderator.ts` e2e fixture helper (raw SQL insert, same
   reasoning as the existing `seed-candidate.ts`: this service's own
   minimal schema doesn't model `username`/`password_hash`, but the
   fixture still has to satisfy their `NOT NULL` constraints).
5. 20 unit tests (5 new sla_breach cases, 1 `handleMessage`-level
   candidateId-guard case) and 2 new e2e tests against real Redpanda/
   Postgres/Mailpit (claimed breach → email + idempotent redelivery;
   unclaimed breach → no email, no log row) — full suites green in CI.

## What this enabled

The breach-detection loop (#488) now actually reaches a human, for the
one case where there's someone to reach. Combined with #490's queue-UI
badge, a moderator who claims an entry gets both a passive "Due in X" /
"Overdue by X" indicator while browsing the queue, and an active email
if they miss the deadline entirely.
