# Phase 51, Issue #705 — `notification-service` Consumer Extension + Templates for `staff.*` Events

*Part of Phase 51 — Staff/Admin/Moderator Notification Platform.
See `docs/ROADMAP.md` Phase 51, `docs/DECISIONS.md` D104.*

## The gap

#701-#704 built the schemas, the publishers, and the recipient-resolution
service — but `NotificationConsumerService` didn't subscribe to any of
the five `staff.account.*.v1` topics yet, and had no templates for any
of them. An admin creating a new staff account, changing a role,
deactivating/reactivating an account, or resetting a password produced
zero signal to the affected person.

## The fix: extend the existing consumer group, one template per event type

Unlike #704's SLA events, `staff.account.*` emails are single-recipient
— the affected account's own `email` field is already on the event
payload (#701), so this consumer needs no lookup through
`StaffNotificationRecipientsService` at all. `processStaffAccountEvent()`
computes the standard `entityType`/`entityId`/`moderationQueueEntryId`
triple (using `event.actionId` in the fourth slot, per #701's
disambiguation design), checks `NotificationLog` for idempotency, and
sends via `mailService.send({ to: event.email, ...staffAccountNotificationFor(event) })`
— no Prisma query for a recipient anywhere in the path, which makes this
the simplest consumer branch in the file.

```ts
private staffAccountNotificationFor(event: StaffAccountEvent) {
  switch (event.eventType) {
    case 'staff.account.created':
      return {
        subject: 'Your staff account has been created',
        text: `Your role: ${event.role}. Temporary password: ${event.temporaryPassword}`,
        html: `...`,
      };
    case 'staff.account.role_changed':
      return {
        subject: 'Your staff role has changed',
        text: `Your role changed from ${event.oldRole} to ${event.newRole}.`,
        html: `...`,
      };
    // deactivated / reactivated / password_reset follow the same shape
  }
}
```

## Two correctness fixes surfaced by adding a sixth event family

**`isCreatedEvent()`'s string-suffix check was a latent bug.** It read
`event.eventType.endsWith('.created')` — which worked fine across the
first four created-event types (`moderation.round_rating.created`, etc.)
but would have silently misclassified `'staff.account.created'` as a
candidate-facing `CreatedEvent` too, routing it into
`notificationFor()`'s pending-review template path instead of the
correct staff-account one. Replaced with an explicit
`CREATED_EVENT_TYPES` allow-list Set of the four legitimate strings —
closing the exact collision this event family would otherwise have
walked straight into.

**Set-based membership checks lose TypeScript's narrowing.** The
`candidateId`-presence validation in `parseEvent()` had grown into a
chain of `!==` comparisons as event types accumulated across phases;
converting it to `NO_CANDIDATE_ID_EVENT_TYPES.has(event.eventType)`
is more maintainable but broke `tsc` at the following
`!event.candidateId` check (`Property 'candidateId' does not exist on
type 'ModerationEvent'`) — a runtime `Set.has()` call doesn't give
control-flow analysis the same narrowing a literal comparison chain
does. Fixed with an explicit type guard:

```ts
function hasCandidateId(
  event: ModerationEvent,
): event is Exclude<ModerationEvent, ModerationQueueSlaBreachEventV1 | ModerationQueueSlaWarningEventV1 | StaffAccountEvent> {
  return !NO_CANDIDATE_ID_EVENT_TYPES.has(event.eventType);
}
```

## A stale e2e assertion from #704, caught while adding this issue's own test

Reviewing `notifications.e2e-spec.ts` for where to place the new
`staff.account.created.v1` case turned up a test that had never been
updated for #704's own behavior change: *"a real moderation.queue.sla_breach.v1
event with no claimant never sends an email"* — that was #704's
*pre-fix* behavior, asserted as if it were still current, because #704's
PR had updated the unit tests but missed this real-infrastructure e2e
spec. Rewritten to assert the actual escalate-to-active-admins behavior,
with a new, correctly-scoped test added alongside it for the genuine
no-active-admins no-op case. Bundled into this commit rather than
reopening #704, since #704 was already merged.

That fix uncovered a second, smaller bug once CI actually ran it: this
test suite has no per-test Postgres truncation (only `beforeAll`/
`afterAll`), so the admin seeded by the "escalates to every active
admin" test was still active in the database when the "no active
admins" test ran after it — making that test's own premise false and
failing it in CI (a state this session hadn't exercised locally, since
these are real-infrastructure e2e tests that need a live broker/DB/mail
stack). Fixed by reordering the two tests so the no-admins case runs
*before* the escalation case ever seeds one, with a comment on both
tests explaining why the order is load-bearing.

`seedModeratorWithEmail()` gained an optional `role` parameter
(`'staff' | 'moderator' | 'admin'`, defaulting to `'moderator'` to match
the real column's own default) to let the escalation test seed a
genuine admin.

## Verification

72/72 notification-service unit tests passing (41 in
`notification-consumer.service.spec.ts` alone, including six new cases
for the five `staff.account.*` templates plus a resubmission-style
non-collision check on `actionId`); `tsc --noEmit`/`eslint` clean on both
`api` and `notification-service`; 600/600 `api` unit tests passing,
unaffected as expected. Real-infrastructure e2e case for
`staff.account.created.v1` needs no seeded `Candidate`/`Moderator` row
at all — the recipient email is already on the event — and confirms
both the Mailpit delivery and the `NotificationLog` dedup row.
