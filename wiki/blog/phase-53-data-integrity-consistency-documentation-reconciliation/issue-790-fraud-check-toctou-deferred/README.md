# Phase 53, Issue #790 — Fraud-Check Rate Limit Is a TOCTOU Race

*Part of Phase 53 — Data Integrity, Consistency & Documentation
Reconciliation. See `docs/ROADMAP.md` Phase 53, `docs/DECISIONS.md` D13.*

## The gap

`FraudChecksService.checkRateLimit()` (D52) counts a candidate's
`InterviewProcess` creations within a rolling window under Postgres's
default READ COMMITTED isolation:

```ts
async checkRateLimit(candidateId: string, tx: PrismaTransaction = this.prisma): Promise<boolean> {
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const count = await tx.interviewProcess.count({
    where: { candidateId, createdAt: { gte: windowStart } },
  });
  return count >= RATE_LIMIT_MAX_SUBMISSIONS;
}
```

Two concurrent submissions from the same candidate can both read the
same count before either one's write commits — a plain
check-then-act race. Both could read "2 so far, under the cap of 3,"
proceed, and both commit — the candidate ends up at 4, over the
threshold that should have flagged the second one.

## The fix: documented, not fixed

This is the one issue in Phase 53 with no code change — a deliberate,
recorded decision not to fix it, same "know the tradeoff, write it
down" discipline this codebase applies elsewhere (D13's own
full-table-scan acceptances). The reasoning, added directly at the call
site:

```ts
// GitHub issue #790 (Phase 53) — this plain COUNT(*) under READ
// COMMITTED is a TOCTOU race: two concurrent submissions can both read
// a stale count and exceed the threshold without either ever tripping
// the flag. Deliberately left as is — this only ever gates a
// `flagReason` annotation, never a hard block (D13), so the worst case
// is a missed flag on a human reviewer's radar, not a security or data
// integrity issue. If tightened later, use the same atomic
// updateMany-with-a-WHERE-clause pattern review()'s reviewedAt race fix
// already established (GitHub issue #674) for the identical race class.
```

The load-bearing fact making this an acceptable tradeoff rather than a
real bug: `detectFlagReason()` never blocks a write outright (CLAUDE.md
hard constraint #2 — every rating/review still starts `pending`
regardless). The worst outcome of losing this race is a `flagReason`
that should have been `'rate_limit'` staying unset — a missed signal on
a moderator's radar, not a bypassed control. A real fix exists and is
documented (the same atomic `updateMany`-gated-on-a-`WHERE`-clause
pattern #674 already proved out for `ModerationService.review()`'s own
`reviewedAt` race), deliberately not applied here because the actual
risk doesn't currently justify the added complexity.

## Verification

No new test — there's no new behavior to verify, only a documented
decision not to change existing behavior. The existing rate-limit unit
tests (crossing the threshold, staying under it) continue to pass
unchanged, confirming the non-fix genuinely changed nothing observable.
