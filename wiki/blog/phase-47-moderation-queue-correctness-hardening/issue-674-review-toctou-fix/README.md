# Phase 47, Issue #674 — Fix the TOCTOU Race in `ModerationService.review()`

*Part of Phase 47 — Moderation Queue Correctness Hardening.
See `docs/ROADMAP.md` Phase 47, D104.*

## The gap this closed

Phase 47 came out of an end-to-end audit of this project's notification/
communication chains (D104). One finding stood out as an active
correctness bug, not a missing feature: `ModerationService.review()` —
the shared method behind `approve()`/`reject()`/`flag()`, and behind the
AI auto-approval path (`approveWithAudit()`, Phase 39) — read a queue
entry, checked `reviewedAt === null`, and only *then* wrote the decision:

```ts
const entry = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });

if (entry.reviewedAt) {
  throw new ConflictException('This item has already been reviewed.');
}

// ... entity-existence check, then:

const updatedEntry = await this.prisma.$transaction(async (tx) => {
  const updated = await tx.moderationQueueEntry.update({
    where: { id },              // <-- unconditional on reviewedAt
    data: { reviewedAt: new Date(), reviewedBy: dto.reviewedBy, flagReason },
  });
  // ... flip the entity's own status, publish events, etc.
});
```

The read and the write are two separate round trips with no lock held
between them. Two callers acting on the same entry within that window —
two moderators clicking approve within milliseconds of each other, or a
moderator racing the AI auto-approval consumer (Phase 39, issue #340) —
can both pass the `reviewedAt: null` check before either commits. Both
then run the transaction, both flip the underlying `RoundRating` (or
`RecruiterRating`/`OverallReview`/`Company`) status, and both publish a
`status_changed` event and (best-effort) a notification-service email. In
the worst case that's two contradictory decisions landing on the same
entity — approved *and* rejected — with two separate emails to the same
candidate.

## The fix: make the write itself the check

The classic fix for a check-then-act race on a relational database is to
fold the check into the write's own `WHERE` clause, so the database's row
lock does the serializing instead of application code:

```ts
const updatedEntry = await this.prisma.$transaction(async (tx) => {
  const { count } = await tx.moderationQueueEntry.updateMany({
    where: { id, reviewedAt: null },   // <-- the gate moved here
    data: { reviewedAt: new Date(), reviewedBy: dto.reviewedBy, flagReason },
  });
  if (count === 0) {
    throw new ConflictException('This item has already been reviewed.');
  }
  const updated = await tx.moderationQueueEntry.findUniqueOrThrow({ where: { id } });
  // ... rest of the transaction unchanged
});
```

`updateMany` (not `update`) is the mechanism here — Prisma's `update()`
only accepts a unique `where` (just `{ id }`), so it can't express "only
if `reviewedAt` is still null." `updateMany()` accepts an arbitrary
filter, and its return value includes the affected row count instead of
the row itself.

Postgres takes a row lock for the duration of the `UPDATE` statement. A
second concurrent call's `updateMany` blocks until the first commits,
then re-evaluates its own `WHERE` clause against the now-committed row —
`reviewedAt` is no longer `null`, so it matches zero rows. `count === 0`
at that point means *this call lost the race*, not that the entry doesn't
exist (existence was already confirmed earlier in the method, before the
transaction). The original `findUniqueOrThrow`-based check right at the
top of the method stays in place too — it's now a fast-path optimization
(skip the entity-existence check and the transaction entirely for the
common sequential case), not the actual correctness guarantee.

## Verification

Two new unit tests in `moderation.service.spec.ts`, both mocking
`updateMany` directly rather than trying to fake Postgres row-locking:

1. **Direct**: `updateMany` mocked to return `{ count: 0 }` even though
   the initial `findUniqueOrThrow` read returned `reviewedAt: null` —
   proves the method trusts the write's own result over the earlier
   read.
2. **End to end**: two real `service.approve()` calls fired via
   `Promise.allSettled`, against a hand-rolled *stateful* mock of
   `moderationQueueEntry` (`updateMany` only reports `count: 1` while its
   internal `reviewedAt` state is still `null`) — asserts exactly one of
   the two settles fulfilled and the other rejects with
   `ConflictException`.

The stateful-mock approach matters here: a plain `jest.fn().mockResolvedValue()`
can't express "the second call sees the first call's write" — it always
returns the same canned value regardless of call order. Modeling
`updateMany` as a small state machine (gate check, then mutate, then
return a count) is what makes the concurrent-call test meaningful rather
than trivially true.

81/81 tests passed in `moderation.service.spec.ts`, and the full API
suite (517 tests) was unaffected. `claim()`/`release()` have the exact
same race shape but were deliberately left alone here — tracked
separately as issue #675, same fix pattern.
