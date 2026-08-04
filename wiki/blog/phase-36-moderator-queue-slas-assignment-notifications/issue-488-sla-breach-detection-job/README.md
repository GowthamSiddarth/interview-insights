# Phase 36, Issue #488 — SLA Breach Detection Job

*Part of Phase 36 — Moderator Queue SLAs, Assignment & Notifications. See
`docs/ROADMAP.md` Phase 36 and `docs/DECISIONS.md` D80.*

## The gap this closed

`slaDeadline` (#486) was a column nobody read. A breach needs to fire on
its own — the issue's own scope note ruled out the lazy self-heal-on-
load pattern D69 used for the moderator search index (re-indexing
whatever's stale the next time someone happens to load the page):
nothing guarantees a moderator opens the queue right when an entry
breaches, or ever, if the queue is quiet. This needs a real scheduler.

## Key concept: in-process `@Cron`, not a Kubernetes CronJob — reusing a precedent, not re-litigating it

D72 already answered almost this exact question for Phase 39's
reconciliation sweep: `@nestjs/schedule`'s `@Cron()`, in-process inside
`api`, not a dedicated CronJob manifest. The reasoning transfers
directly — no existing cron/worker infrastructure to justify the extra
moving parts (a new container entry point, RBAC, its own retry
semantics) for a job that runs in well under a second per sweep at
today's scale. `ScheduleModule.forRoot()` was already registered
app-wide in `AppModule` (the reconciliation sweep needed it first), so
`SlaBreachDetectionService` needed zero new module wiring beyond adding
itself as a provider:

```ts
@Cron(CronExpression.EVERY_HOUR)
async sweep(): Promise<void> {
  const breached = await this.prisma.moderationQueueEntry.findMany({
    where: { reviewedAt: null, breachNotifiedAt: null, slaDeadline: { lt: new Date() } },
    select: { id: true, entityType: true, entityId: true, slaDeadline: true, claimedById: true },
  });
  for (const entry of breached) await this.notifyBreach(entry);
}
```

## Key concept: a new column earns its keep on idempotency alone

An hourly sweep querying "unreviewed and past deadline" would
re-publish an event for the same still-breached entry on every single
tick until someone reviews it — not "once per breach" as the issue
asked for. `breach_notified_at` (a new nullable timestamptz, hand-
authored migration) closes that: set the first time this entry gets
notified, excluded from the query thereafter. Never cleared, even once
the entry is reviewed — the same "record what happened, don't erase
history" precedent `slaDeadline`'s own column comment already
established.

## Key concept: the stamp isn't conditioned on a signal that doesn't exist

Should a breach get re-published if the broker was down the first
time? `DomainEventPublisher.publish()` is deliberately best-effort
(D16/D17/D53) — it catches every failure internally and never surfaces
success or failure back to its caller. There's nothing to condition the
stamp on. `breachNotifiedAt` is set unconditionally, right after
calling `publish()`:

```ts
await this.domainEventPublisher.publish(MODERATION_QUEUE_SLA_BREACH_V1_TOPIC, event, entry.id);
await this.prisma.moderationQueueEntry.update({
  where: { id: entry.id },
  data: { breachNotifiedAt: new Date() },
});
```

The accepted tradeoff, written up in D80: a breach detected during a
broker outage is silently dropped once, not retried indefinitely on
every later sweep — the same "tried once, moved on" contract every
other domain event in this codebase already has, not a new gap this
feature introduces.

## Key concept: a tenth event, and the first one not published from a write path

Every event this project has published until now came from a write
path — a rating being created, a moderation decision being made.
`moderation.queue.sla_breach.v1` is the first one published from a
scheduled scan instead, and it's scoped to `moderation_queue` itself
rather than one of the three rated/reviewed entity types — it fires for
a `company` moderation request too, unlike every `*.created`/
`*.status_changed`/`*.verdict_computed` event before it.

## Step-by-step: what actually got built and verified

1. Hand-authored migration adding `breach_notified_at`
   (`moderation_queue`), applied via `migrate deploy` to both dev and
   test Postgres.
2. New event schema (`moderation-queue-sla-breach.event.ts`):
   `queueEntryId`, `entityType`/`entityId` (context, not a gate),
   `slaDeadline`, `claimedById` (nullable — resolved to a recipient by
   #489, not baked in here as an email address).
3. `SlaBreachDetectionService`, registered as a provider on
   `ModerationModule` — no `ScheduleModule` re-import needed.
4. `docs/EVENTS.md` updated: the event, its topic, and "published from
   a scheduled scan, not a write path" called out explicitly as new.
5. 8 new unit tests (query shape, per-entry publish with
   `claimedById` carried through unchanged including the `null` case,
   the stamp happening regardless of publish outcome, continuing past a
   stamp failure without throwing) — 462/462 full unit suite green,
   `tsc`/`eslint` clean.

## What this enabled

#489 (notification-service emailing the claiming moderator) and #490
(the queue UI's overdue badge) both needed this event/column to exist
first — #489 consumes the event directly, #490 reads `slaDeadline`
(already available since #486) independent of whether a breach has
actually been detected yet.
