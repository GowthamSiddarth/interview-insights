# Phase 51, Issue #704 — Tiered SLA Escalation

*Part of Phase 51 — Staff/Admin/Moderator Notification Platform.
See `docs/ROADMAP.md` Phase 51, `docs/DECISIONS.md` D104.*

## The gap

`SlaBreachDetectionService`'s hourly sweep (Phase 36, #489) notified the
claiming moderator once their claimed entry breached its SLA — but
that's the *only* case it handled. Under this project's manual-claim-only
model (D80, no auto-assignment), an entry that breaches its SLA while
still unclaimed hit `notification-consumer.service.ts`'s own
`if (!event.claimedById) { ...skip... }` branch and notified nobody. A
genuinely stuck, unclaimed queue entry could sit indefinitely with zero
human aware of it — a real silent-failure gap, not a hypothetical one.

## The fix: two tiers instead of one

**Tier 1 — 75% of SLA elapsed, still unclaimed.** New `sweepWarnings()`
method, run in the same hourly `@Cron` alongside the existing sweep.
Finds entries at least 75% through their SLA window that haven't been
warned yet (tracked via a new `warningNotifiedAt` column, same
stamp-after-publish best-effort shape `breachNotifiedAt` already uses)
and publishes a new `moderation.queue.sla_warning.v1` event per entry.

**Tier 2 — 100% elapsed, still unclaimed.** The existing `sweepBreaches()`
tier is unchanged on the `api` side — same event, same `sla_breach.v1`
topic. What changes is entirely downstream, in `notification-service`:
an unclaimed breach that previously hit the skip branch now escalates to
every active admin instead, via #703's `StaffNotificationRecipientsService.
activeAdminEmails()`.

**100% elapsed, claimed** is unchanged in both places — still emails the
claimant directly, same as Phase 36 shipped it.

```ts
async sweepWarnings(): Promise<void> {
  const entries = await this.prisma.moderationQueueEntry.findMany({
    where: {
      status: 'pending',
      claimedById: null,
      warningNotifiedAt: null,
      slaDeadline: { lte: this.warningThreshold() }, // 75% elapsed
    },
  });
  for (const entry of entries) {
    const event: ModerationQueueSlaWarningEventV1 = { ... };
    await this.domainEventPublisher.publish(MODERATION_QUEUE_SLA_WARNING_V1_TOPIC, event, entry.id);
    await this.prisma.moderationQueueEntry.update({
      where: { id: entry.id },
      data: { warningNotifiedAt: new Date() },
    });
  }
}
```

On the consumer side, `moderation.queue.sla_warning.v1` always broadcasts
to `activeModeratorEmails()` (both `moderator` and `admin` roles — anyone
who could actually claim the entry), while an unclaimed
`moderation.queue.sla_breach.v1` escalates to `activeAdminEmails()` only
— a warning is "someone should pick this up," a breach is "this has
already been missed, an admin needs to know." Both reuse the exact same
`NotificationLog` idempotency machinery every other event in this
service already has, keyed the normal `moderation_queue`-entity way
(these *do* have a real `moderation_queue` entry to key off, unlike
#701's staff-account events).

## A gotcha in the tests: two `findMany` calls, one mock

`sweep()` now calls `prisma.moderationQueueEntry.findMany` twice per run
— once inside `sweepWarnings()`, once inside `sweepBreaches()`. Every
existing test in `sla-breach-detection.service.spec.ts` used a single
`mockResolvedValue()`, which returns the same fixture array for *both*
calls — silently double-processing entries and producing warning emails
for entries the test only intended to exercise the breach path for.
Fixed by converting every test to explicit `mockResolvedValueOnce()`
calls in call order (warnings sweep first, breaches sweep second), with
a small `mockNoWarnableEntries()` helper for tests that only cared about
the breach tier.

## Verification

Extensive `sla-breach-detection.service.spec.ts` coverage for both
tiers independently and together; `notification-consumer.service.spec.ts`
gained cases for the warning broadcast, the admin escalation, and the
still-unchanged claimed-breach path; a real-infrastructure e2e case in
`notifications.e2e-spec.ts` proves an unclaimed breach reaches a seeded
active admin (and a parallel case proves it reaches no one when no admin
exists — the two had to be ordered carefully since this suite shares
Postgres state across tests within the same file with no per-test
truncation, see #705's own writeup for where that bit).
