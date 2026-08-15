# Phase 47, Issue #675 — Fix the Same TOCTOU Race in `claim()`/`release()`

*Part of Phase 47 — Moderation Queue Correctness Hardening.
See `docs/ROADMAP.md` Phase 47, D104.*

## The gap this closed

Issue #674 fixed a check-then-act race in `ModerationService.review()`.
`claim()` and `release()` (Phase 36, issue #487 — manual "I've got this"
claiming, not a gate on actually reviewing) had the identical shape:
read the entry, check a condition, then write unconditionally on `id`
alone:

```ts
async claim(id: string, moderatorId: string) {
  const entry = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });

  if (entry.reviewedAt) throw new ConflictException('This item has already been reviewed.');
  if (entry.claimedById) throw new ConflictException('This item is already claimed by another moderator.');

  return this.prisma.moderationQueueEntry.update({
    where: { id },                              // <-- unconditional
    data: { claimedById: moderatorId, claimedAt: new Date() },
    include: { claimedBy: { select: { id: true, username: true } } },
  });
}
```

Two moderators clicking "claim" on the same unclaimed entry within the
same narrow window can both pass the `claimedById: null` check, then both
write. Postgres serializes the two `UPDATE`s at the row level (one always
runs after the other), but since neither write is *conditioned* on the
value it read, the second write silently overwrites the first's
`claimedById` — both moderators get a 201 response claiming they now own
the entry, but only whoever wrote last actually does. (The blast radius
here is smaller than #674's — nothing in this codebase gates the actual
`approve`/`reject`/`flag` decision on holding a claim, it's an
optional signal — but a stale "who owns this" badge is still a real bug,
and the fix is the same three lines either way.)

## The fix

Same pattern as #674: move the condition from the read into the write's
own `WHERE` clause via `updateMany`, check the affected row count, and —
since a losing call now has no fresh read to build its error message
from — do one cheap re-fetch on the losing path only, to report the
*specific* reason (already reviewed vs. already claimed by someone else):

```ts
async claim(id: string, moderatorId: string) {
  const entry = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });

  if (entry.reviewedAt) throw new ConflictException('This item has already been reviewed.');
  if (entry.claimedById) throw new ConflictException('This item is already claimed by another moderator.');

  const { count } = await this.prisma.moderationQueueEntry.updateMany({
    where: { id, reviewedAt: null, claimedById: null },   // <-- the gate
    data: { claimedById: moderatorId, claimedAt: new Date() },
  });
  if (count === 0) {
    const current = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });
    if (current.reviewedAt) throw new ConflictException('This item has already been reviewed.');
    throw new ConflictException('This item is already claimed by another moderator.');
  }

  return this.prisma.moderationQueueEntry.findUniqueOrThrow({
    where: { id },
    include: { claimedBy: { select: { id: true, username: true } } },
  });
}
```

`release()` got the mirror-image fix, gated on `claimedById: moderatorId`
(the exact condition its own initial read checked) instead of
`claimedById: null`:

```ts
const { count } = await this.prisma.moderationQueueEntry.updateMany({
  where: { id, claimedById: moderatorId },
  data: { claimedById: null, claimedAt: null },
});
if (count === 0) {
  const current = await this.prisma.moderationQueueEntry.findUniqueOrThrow({ where: { id } });
  if (!current.claimedById) throw new ConflictException('This item is not currently claimed.');
  throw new ForbiddenException('This item is claimed by another moderator.');
}
```

`release()`'s own interesting case: two `release()` calls for the *same*
claim, fired concurrently. The naive expectation is "both succeed,
idempotently" — but the second call's `updateMany` runs against a row
the first call already flipped to `claimedById: null`, so its own
`where: { id, claimedById: moderatorId }` matches zero rows. The re-fetch
on that losing path correctly reports "not currently claimed" instead of
silently no-op-succeeding a second time — a small but real distinction:
the caller finds out their release() didn't actually do anything, rather
than getting a false "success."

## Verification

Both methods got the same two-tier test treatment as #674: a direct test
per method asserting `updateMany` returning `{ count: 0 }` produces the
right `ConflictException`/`ForbiddenException` even when the initial read
looked clean, plus an end-to-end concurrent-call test against the same
stateful mock pattern #674 introduced (generalized here to check an
arbitrary `WHERE` clause against live mock state, not just a single
`reviewedAt` field, since `claim()` and `release()` each gate on
different columns). The `release()` concurrency test in particular
exercises the "second release of the same claim" case above. 81/81 tests
passed; full API suite unaffected.
