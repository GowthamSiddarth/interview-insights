# Phase 49, Issue #687 — Fix `NotificationLog`'s Idempotency Key

*Part of Phase 49 — Resubmission Loop & Rejection Feedback.
See `docs/ROADMAP.md` Phase 49, D104.*

## The confirmed bug

This is the headline bug Phase 49 exists to fix, and #686 set it up:
`NotificationLog`'s unique constraint was
`(entity_type, entity_id, event_type)`. A candidate editing a
rejected/flagged rating gets re-enqueued into a fresh
`ModerationQueueEntry` row for the *same* entity — `reenqueue()`
supersedes the old unreviewed entry, but the entity's own id never
changes. So the sequence "reject → edit → approve" produces two
`moderation.round_rating.status_changed` events for the same
`entityId`, and the old dedup key can't distinguish them: the first
event writes a `NotificationLog` row keyed
`(round_rating, <id>, status_changed)`; the second event's own
idempotency check finds that exact same row already present and
silently skips sending. A candidate was never notified of any review
decision after the first one on a given entity — the exact scenario a
resubmission loop is built around.

## The fix

Add `moderation_queue_entry_id` to `NotificationLog` and widen the
unique constraint to include it:

```prisma
model NotificationLog {
  id                     String   @id @default(uuid()) @db.Uuid
  entityType             String   @map("entity_type")
  entityId               String   @map("entity_id") @db.Uuid
  eventType              String   @map("event_type")
  // Empty string default for event types that don't carry a real one
  // (created/sla_breach) so their pre-existing dedup behavior is
  // unchanged; the actual moderation_queue entry id for status_changed
  // events, giving each resubmission's decision its own dedup key.
  moderationQueueEntryId String   @default("") @map("moderation_queue_entry_id")
  sentAt                 DateTime @default(now()) @map("sent_at") @db.Timestamptz

  @@unique([entityType, entityId, eventType, moderationQueueEntryId], name: "notification_log_dedup_key")
  @@map("notification_log")
}
```

Empty string, not a nullable column, is the deliberate choice for the
"doesn't need one" cases — Postgres treats `NULL` as distinct from every
other `NULL` in a unique constraint (two `NULL` rows never conflict),
which would silently defeat the uniqueness guarantee for `created`/
`sla_breach` events entirely. A fixed empty-string sentinel participates
in the constraint normally.

`NotificationConsumerService` derives the key value from #686's new
event field, empty string when the event shape doesn't carry one:

```ts
function moderationQueueEntryIdFor(event: ModerationEvent): string {
  return isStatusChangedEvent(event) ? (event.moderationQueueEntryId ?? '') : '';
}
```

Both the idempotency-check read and the record-sent write switched from
the old three-field key to this four-field one — a one-line change at
each call site, since Prisma's compound-unique lookup just takes the new
field as part of the same `where` object.

Applied via a hand-authored `migration.sql` (this project's established
`prisma migrate deploy`-only workflow, D64) — `ALTER TABLE` to add the
column, drop the old three-field unique index, add the new four-field
one.

## Verification

`notification-consumer.service.spec.ts` gained tests proving the two
halves of the fix independently: a decision on a *new* queue entry for
an entity that already has a notification recorded (from a *previous*
queue entry) is treated as un-notified and sent; a genuine redelivery of
the *same* event (same queue entry id) is still correctly deduped and
skipped. `notifications.e2e-spec.ts` — real Redpanda/Postgres/Mailpit,
this project's "needs a real instance" standard for domain-event
plumbing — got the same two cases proven against actual infrastructure,
not just mocks.
