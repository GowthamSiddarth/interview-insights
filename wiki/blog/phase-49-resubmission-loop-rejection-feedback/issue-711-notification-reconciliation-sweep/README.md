# Phase 49, Issue #711 — `notification-service` Reconciliation Sweep

*Part of Phase 49 — Resubmission Loop & Rejection Feedback.
See `docs/ROADMAP.md` Phase 49, D104 and D106.*

## The gap

`notification-service` had no answer for a lost or never-processed
event — a broker hiccup mid-publish, a consumer restart at the wrong
moment, a message that arrives but the send itself transiently fails in
a way that never gets retried. `review-analyzer` had already solved
exactly this shape of problem for its own `*.created` consumption
(`ReconciliationSweepService`, issues #442/#340, D81): an hourly `@Cron`
sweep that re-derives "should this have happened by now?" straight from
Postgres state, rather than depending on a literal Kafka dead-letter
topic or a transactional outbox. `notification-service` never got the
equivalent.

This became directly relevant once #687 fixed the idempotency key: a
correct dedup key is what makes "already sent" and "missing" actually
distinguishable to a sweep in the first place — a sweep built against
the old three-field key couldn't have told a genuinely-missed
resubmission notification apart from a properly-deduped one. #711
explicitly depends on #687 landing first.

The issue shipped in two passes. The first covered `*.status_changed`
only. D106 (found during a later Phase-8g reconciliation pass) pointed
out the decision text had always scoped this to *both* `*.created` and
`*.status_changed` — the first pass was an incomplete reading of its own
issue, caught and fixed as a same-day follow-up commit rather than a
separate issue.

## The fix

`ReconciliationSweepService`, mirroring `review-analyzer`'s own shape
closely:

```ts
@Cron(CronExpression.EVERY_HOUR)
async sweep(): Promise<void> {
  await this.sweepStatusChanged();
  await this.sweepCreated();
}
```

`sweepStatusChanged()` scans `moderation_queue` directly for entries
reviewed more than an hour ago (D104's staleness window — no LLM-retry
latency to account for here, unlike `review-analyzer`'s 24h), checks
`NotificationLog` for the matching dedup row keyed by that queue entry's
own id, and resends if missing:

```ts
private async sweepStatusChanged(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALENESS_WINDOW_MS);
  const staleEntries = await this.prisma.moderationQueueEntry.findMany({
    where: { reviewedAt: { not: null, lt: staleBefore } },
  });
  for (const entry of staleEntries) {
    await this.reconcileStatusChanged(entry.id, entry.entityType, entry.entityId);
  }
}
```

This query is naturally bounded — there are only ever as many reviewed
queue rows as there have been decisions. `sweepCreated()` has no
equivalent narrowing column (an entity's `createdAt` never changes, and
every row has one), so it needs an explicit upper bound too, or it would
rescan the entire table's history every single hour forever:

```ts
const CREATED_SWEEP_MAX_AGE_MS = 25 * 60 * 60 * 1000; // deliberately > STALENESS_WINDOW_MS

private async sweepCreated(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALENESS_WINDOW_MS);
  const veryStaleBefore = new Date(Date.now() - CREATED_SWEEP_MAX_AGE_MS);
  const window = { gte: veryStaleBefore, lt: staleBefore };
  // ... per NOTIFIABLE_ENTITY_TYPES, find rows created in `window`
}
```

A rare miss outside the 1h–25h band going unfixed is an accepted
trade-off: a `*.created` miss is a low-stakes "we got it" courtesy
email, not the consequential approve/reject notification the
unbounded `status_changed` half already covers fully.

The sweep needed three new minimal read-only Prisma mirrors —
`ModerationQueueEntry`, `RoundRating`, `RecruiterRating`,
`OverallReview` — following the same D75 pattern the existing
`Candidate`/`Moderator` mirrors already established, scoped to only the
fields the sweep actually reads. Both `subjectAndBodyFor()` and
`pendingReviewSubjectAndBody()` were extracted into a shared
`notification-templates.util.ts` so the sweep and the live Kafka
consumer send byte-identical copy rather than risking two templates
silently drifting apart.

## Verification

`reconciliation-sweep.service.spec.ts` — 314 new lines covering both
sweep halves independently: a stale reviewed entry with no matching
`NotificationLog` row gets resent; one that already has a row is left
alone; an entity created within the bounded window with no `*.created`
notification gets resent; one outside the window (too fresh or too
stale) is correctly excluded from the query entirely, not just skipped
after being fetched.
