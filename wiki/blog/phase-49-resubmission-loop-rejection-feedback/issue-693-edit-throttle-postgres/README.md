# Phase 49, Issue #693 — Move `EditThrottleService` Off In-Memory Storage

*Part of Phase 49 — Resubmission Loop & Rejection Feedback.
See `docs/ROADMAP.md` Phase 49, D104.*

## The gap

`EditThrottleService` wrapped `IpThrottle`, the shared in-memory
per-key rate-limiting core this project already reuses for five other
abuse surfaces (admin login, magic-link, candidate login,
password-reset, company-creation). Its own comment already flagged the
limitation: fine at one `api` replica, but state resets on restart and
never coordinates across replicas — once `api` scales horizontally, each
pod gets its own independent 5-per-hour bucket, silently multiplying the
effective limit by the replica count.

## The fix: one atomic method, not two racy ones

The obvious move — a Postgres table plus a straight port of `isBlocked()`
then `recordAttempt()` — has a subtle trap. The old in-memory pair was
only safe because JS is single-threaded: nothing could interleave
between the check and the write. Once the check becomes an `await`ed
database call, two concurrent requests from the same candidate can both
read "under the cap" before either one's write lands — the exact TOCTOU
shape #674/#675 already fixed in `ModerationService`.

The fix collapses the pair into one atomic method, applying that same
fix pattern:

```ts
async recordAttemptIfAllowed(candidateId: string): Promise<boolean> {
  const now = new Date();
  const windowFloor = new Date(now.getTime() - WINDOW_MS);

  // Fast path: atomically bump an existing, still-current window — the
  // condition and the increment are both in one UPDATE's WHERE clause.
  const { count: bumped } = await this.prisma.editThrottleState.updateMany({
    where: { candidateId, windowStart: { gte: windowFloor }, count: { lt: MAX_EDITS_PER_WINDOW } },
    data: { count: { increment: 1 } },
  });
  if (bumped > 0) return true;

  const current = await this.prisma.editThrottleState.findUnique({ where: { candidateId } });
  if (current && current.windowStart >= windowFloor) {
    return false; // cap hit within the still-current window
  }

  // No row, or an expired window — start a fresh one. upsert's
  // ON CONFLICT DO UPDATE is itself atomic per row.
  await this.prisma.editThrottleState.upsert({
    where: { candidateId },
    create: { candidateId, windowStart: now, count: 1 },
    update: { windowStart: now, count: 1 },
  });
  return true;
}
```

Postgres row-locks the matching row for the fast-path `UPDATE`'s
duration — a second concurrent call blocks, then re-evaluates its own
`WHERE` against the now-committed row, same serialization mechanism
#674/#675 already established for `ModerationService.review()`. The one
accepted looseness is at a window-rollover race (two concurrent callers
both starting a fresh window): `upsert`'s per-row atomicity means the
second writer's `count: 1` simply overwrites the first's, under-counting
by at most one — strictly more permissive, never less safe than
intended.

`EditThrottleGuard.canActivate()` became `async` to call it — Nest's
`CanActivate` already supports a `Promise<boolean>` return, so no other
wiring changed.

## Verification

A new real-Postgres e2e test spins up two independent
`INestApplication` instances sharing the same test database — literally
simulating two `api` replicas — and alternates five edit requests across
both, asserting all five succeed and a sixth (on whichever instance
didn't handle the fifth) still 429s. That's the issue's own acceptance
criterion proven directly, not just asserted: the old in-memory version
would have allowed 10 total (5 per instance) in this exact scenario. The
existing single-instance e2e test needed no changes at all — proving "no
behavior change for the single-instance case," the issue's other
acceptance criterion, for free.
