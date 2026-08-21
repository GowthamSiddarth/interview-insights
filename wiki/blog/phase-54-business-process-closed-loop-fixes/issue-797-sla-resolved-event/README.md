# Phase 54, Issue #797 — SLA Breach/Warning Notifications Never Signal Resolution

*Part of Phase 54 — Business-Process Closed-Loop Fixes.
See `docs/ROADMAP.md` Phase 54.*

## The gap

`moderation.queue.sla_breach.v1`/`moderation.queue.sla_warning.v1`
(Phase 36/51) are deliberately one-shot — once fired, `breachNotifiedAt`/
`warningNotifiedAt` gets set so the same entry never re-notifies on a
later check. That one-shot design was correct for its original purpose
(don't spam the same escalation repeatedly), but it left a real
operational blind spot: nothing ever signaled when a breached or
warned item was *finally* resolved. An admin who got escalated to at
2am for an unclaimed breach had no way to know — from the notification
stream alone — whether it got picked up five minutes later or sat
untouched for a day. Resolution latency for escalated items was
completely un-auditable from the notification data itself.

## The fix: a new sla_resolved event, published on the resolving decision

```ts
// events/schemas/moderation-queue-sla-resolved.event.ts
export const MODERATION_QUEUE_SLA_RESOLVED_V1_TOPIC = 'moderation.queue.sla_resolved.v1';

export interface ModerationQueueSlaResolvedEventV1 {
  eventType: 'moderation.queue.sla_resolved';
  eventVersion: 1;
  occurredAt: string;
  queueEntryId: string;
  entityType: ModerationEntityType;
  entityId: string;
  decision: 'approved' | 'rejected' | 'flagged';
  reviewedBy: string | null;
  wasBreached: boolean;
  wasWarned: boolean;
  resolutionLatencyMs: number;
}
```

`ModerationService.review()` publishes it, but only when the entry it's
resolving actually had a breach or warning notification fired against
it — a normal, within-SLA review has nothing to signal resolution of:

```ts
// review()'s tail, after every other side effect
if (entry.breachNotifiedAt || entry.warningNotifiedAt) {
  await this.publishSlaResolvedEvent(entry, decision, dto.reviewedBy ?? null, id);
}
```

`resolutionLatencyMs` is computed directly from the entry's own
`slaDeadline` at publish time — `now.getTime() - entry.slaDeadline.getTime()`
— giving a real, queryable "how late was this resolved" number without
needing a second lookup or a derived field stored anywhere. `wasBreached`/
`wasWarned` both ride along so a consumer doesn't need to re-derive which
tier fired just to decide how to phrase the resolution message.

## Verification

Unit tests cover every combination: an entry with neither flag set
publishes nothing (the common case — most reviews are on-time), an
entry with only `warningNotifiedAt` set publishes with `wasBreached:
false, wasWarned: true`, and an entry with `breachNotifiedAt` set
publishes with `wasBreached: true` regardless of decision (approved,
rejected, or flagged all resolve it). One real gotcha surfaced building
this: the test helper mocking a "no notification fired" entry left
`breachNotifiedAt`/`warningNotifiedAt` as `undefined` rather than real
Postgres's `null` — the original `!== null` check evaluated
`undefined !== null` as `true`, firing the event on every single review
in the test suite. Fixed by switching the production check to
`Boolean(entry.breachNotifiedAt)`, which is correct against both
`undefined` and `null` — more robust than matching the test fixture, not
just papering over it.
