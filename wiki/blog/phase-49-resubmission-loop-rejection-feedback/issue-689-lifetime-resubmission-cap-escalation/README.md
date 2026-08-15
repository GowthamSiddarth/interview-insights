# Phase 49, Issue #689 — Lifetime Resubmission Cap + Escalation

*Part of Phase 49 — Resubmission Loop & Rejection Feedback.
See `docs/ROADMAP.md` Phase 49, D104.*

## The gap

Nothing stopped a candidate from editing a rejected rating indefinitely
— `EditThrottleService` limited the *rate* (5/hour) but never the
lifetime count. A determined (or malicious) candidate could cycle
reject-then-edit forever, and every cycle re-enters the same moderation
queue a normal moderator handles, with no escalation path for a pattern
that's clearly no longer a good-faith correction.

## The fix: count for free, off data already being kept

`reenqueue()` already deletes only the still-*unreviewed* duplicate
entry on an edit (`deleteMany({ reviewedAt: null })`) — every past
*reviewed* decision on that `entityId` stays in `moderation_queue`
permanently, as an audit trail. That means counting those rows, right
before creating the new one, is already an exact count of every
submission this entity has ever had — no new counter column needed:

```ts
const LIFETIME_RESUBMISSION_CAP = 3;

async reenqueue(entityType: ModerationEntityType, entityId: string, tx = this.prisma) {
  await tx.moderationQueueEntry.deleteMany({ where: { entityType, entityId, reviewedAt: null } });
  const priorSubmissionCount = await tx.moderationQueueEntry.count({ where: { entityType, entityId } });
  const escalated = priorSubmissionCount >= LIFETIME_RESUBMISSION_CAP;
  return tx.moderationQueueEntry.create({
    data: { entityType, entityId, slaDeadline: this.computeSlaDeadline(), escalated },
  });
}
```

`escalated` is never un-set by a later edit — same "record what had
happened, don't erase history" precedent `slaDeadline` already
established for this table. Once escalated, a new `EscalatedEntryGuard`
gates `approve()`/`reject()` to admin-only:

```ts
@Injectable()
export class EscalatedEntryGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const id = req.params.id as string;
    const entry = await this.prisma.moderationQueueEntry.findUnique({
      where: { id },
      select: { escalated: true },
    });
    if (entry?.escalated && (req.user as AdminSessionPayload).role !== 'admin') {
      throw new ForbiddenException('This item is escalated and can only be resolved by an admin.');
    }
    return true;
  }
}
```

A routing-layer guard, not a parameter threaded through
`ModerationService.review()`'s signature — deliberately minimizing blast
radius across every existing caller, including the system-attributed AI
auto-approval path. That path is excluded even earlier, before ever
reaching the controller, via `VerdictConsumerService`'s own
`queueEntry.escalated` check — a repeatedly-rejected item needs a
human's judgment, never another automated pass.

## Verification

`api/test/moderation.e2e-spec.ts` gained a real-Postgres e2e case
driving three full reject-then-edit cycles and asserting escalation
trips exactly on the third resubmission (not the first or second), that
a non-admin moderator gets a 403 on the escalated entry, and that an
admin can still resolve it. Unit tests cover the count/threshold logic
in isolation, including the boundary case one submission below the cap.
