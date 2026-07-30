# Phase 31, Issue #335 — The First Real Consumer: `*.created` Events → "Pending Review" Email

*Part of Phase 31 — Notification Service. See `docs/ROADMAP.md` Phase 31,
`docs/DECISIONS.md` D73/D74/D75, and `docs/EVENTS.md`.*

## The gap this closed

Issue #334 gave `notification-service` a pod that boots; this issue gives
it a reason to exist. It subscribes to all three
`moderation.*.created.v1` topics Phase 30 wired up, and for every event,
sends a "your submission is pending review" email — idempotently,
because Redpanda is an at-least-once broker and a redelivered event must
never become a second email. Implementing this surfaced a real schema
gap that had nothing to do with Kafka at all: this service had no way to
find out *who* to email.

## Key concept: a hash you can check but never reverse can't address an email

`Candidate.emailHash` (an HMAC, used to look up a candidate by email
without ever storing the plaintext) has been part of this schema since
early on — it answers "does this email already have an account,"
nothing else. Nothing in the schema persisted the *reversible* email
anywhere. That was fine as long as every code path that needed to email
a candidate was the same request that already had the plaintext address
in hand (a magic-link login, a moderation-decision notification sent
synchronously from `api` itself, if that had ever existed). A Kafka
consumer running in a different process, minutes or hours after the
original request, with only a `candidateId` in the event payload, has no
such luxury.

**Fixed by adding `Candidate.emailEncrypted`** — a reversible AES-256-GCM
copy of the address, alongside the existing irreversible hash, written
once at signup by `CandidatesService.create()` under a dedicated
`EMAIL_ENCRYPTION_KEY` (deliberately a different secret from
`EMAIL_HASH_SECRET` — one is designed to be reversed by anything holding
the key, the other by design never should be). Documented as D74.

## Key concept: a second, minimal Prisma schema against the same database — not a shared client

`notification-service` needed to read `Candidate.emailEncrypted` and
write its own dedupe-tracking rows. The two options were: share `api`'s
generated Prisma client as a package, or give this service its own
`schema.prisma` modeling only the columns it actually touches, generated
independently, against the same Postgres database. D75 chose the
second, and made it structural rather than incidental — `api`'s
migrations stay the *one* source of truth for the real schema (CLAUDE.md
hard constraint #5); this service's `schema.prisma` has no
`prisma/migrations/` directory at all, and exists only to type-check
against tables that already exist by the time it boots:

```prisma
// Read-only in practice: only emailEncrypted is ever selected, to
// decrypt a candidate's address for the "pending review" email.
model Candidate {
  id             String  @id @db.Uuid
  emailEncrypted String? @map("email_encrypted")

  @@map("candidates")
}
```

This keeps the two services' schemas decoupled — a migration `api` runs
that adds an unrelated column to `candidates` never forces
`notification-service` to regenerate anything, since its own model only
ever mentions the two columns it needs.

## Key concept: idempotency via a unique constraint, not a distributed lock

`NotificationLog` is a new table this service owns: `(entityType,
entityId, eventType)` unique, one row per notification actually sent.
The dedupe check happens twice, for two different reasons:

```ts
const alreadySent = await this.prisma.notificationLog.findUnique({
  where: { entityType_entityId_eventType: { entityType, entityId, eventType } },
});
if (alreadySent) return; // fast path: skip the common redelivery case

// ...decrypt, send the email...

await this.prisma.notificationLog
  .create({ data: { entityType, entityId, eventType } })
  .catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err; // anything else is a real failure, not a race
  });
```

The `findUnique` up front is an optimization — it makes the overwhelmingly
common case (a redelivery of something already fully handled) a single
cheap read with no email send attempted at all. The real correctness
guarantee is the unique constraint itself, caught as `P2002` on
`create()`: the narrow window where two deliveries of the same event are
processed concurrently (or a crash happens between a successful send and
this row being written) still can't produce two rows, even though it
could in theory produce two emails in that exact race — an accepted,
extremely rare tradeoff, the same one `api`'s own moderation write paths
already accept for their own best-effort side effects.

## Key concept: never crash-loop on a bad broker connection or a bad message

Two failure classes get handled deliberately, not by accident:

- **Connection**: mirrors `DomainEventPublisher`'s own
  reconnect-on-recovery shape from Phase 30 issue #459. `onModuleInit()`
  attempts a connection and logs (not throws) on failure;
  `retryConnectIfNeeded()`, on a 30s `@nestjs/schedule` interval, keeps
  trying until it succeeds — whether the broker was never reachable at
  boot or dropped out later.
- **Malformed messages**: `handleMessage()` never throws. A message that
  fails to parse, or parses into an unrecognized `eventType`, is logged
  and skipped — kafkajs's default behavior (retry, eventually crash the
  whole consumer loop) would otherwise let one bad message stall every
  other candidate's notification indefinitely.

## Step-by-step: what actually got built and verified

1. `Candidate.emailEncrypted` (D74) + `notification-service`'s own
   `Candidate`/`NotificationLog` Prisma models (D75).
2. `NotificationConsumerService`: subscribes to all three
   `moderation.*.created.v1` topics under one consumer group
   (`'notification-service'`), dispatches on `event.eventType` to
   determine `entityType`/`entityId`, runs the idempotency-check →
   decrypt → send → record sequence above.
3. `MailService` (D73): duplicated from `api/src/mail/mail.service.ts`
   rather than extracted into a shared package — this service only ever
   needs the two fixed templates it sends (pending-review here,
   approved/rejected added by issue #336), not a general-purpose mail
   abstraction worth sharing.
4. Unit tests mocking `EVENT_CONSUMER`/`PrismaService`/`MailService`
   directly against `processEvent()`, kept separate from
   `handleMessage()`'s kafkajs-shaped envelope so the business logic is
   testable without a fake `EachMessagePayload`.
5. `test/notifications.e2e-spec.ts`: real Redpanda + Postgres + Mailpit,
   the same "needs a real instance, not a mock" standard `api`'s own
   mail/domain-events e2e specs already set — publish a real event,
   assert the email lands in Mailpit, republish the same event, assert
   the message count never exceeds one.

## What this enabled

The whole broker → consumer → side-effect pattern D53 set out to prove
now works end to end, verified against the real cluster, not just in
theory. Issue #336 reuses every piece of this — the decrypt pattern, the
`NotificationLog` dedupe table, the same consumer group — to add a
second kind of notification without re-deriving any of it.
