# Phase 51, Issue #702 — Publish `staff.*` Events From `StaffAccountsService`

*Part of Phase 51 — Staff/Admin/Moderator Notification Platform.
See `docs/ROADMAP.md` Phase 51, `docs/DECISIONS.md` D104.*

## The gap

#701 defined the five `staff.account.*.v1` schemas but nothing published
them yet — `StaffAccountsService`'s five mutating methods still ended at
`StaffAuditLogService.record()`.

## The fix: one publish call per method, after the audit log commits

Each method — `create`, `updateRole`, `deactivate`, `reactivate`,
`resetPassword` — gained a single `domainEventPublisher.publish(...)`
call placed immediately after its existing `StaffAuditLogService.record()`
call. This is the same best-effort, after-commit shape D16/D17/D53
already establish for every other publisher in this codebase: the write
to `moderators` and the audit-log row are the source of truth, and a
publish failure (broker down, network blip) never rolls back or blocks
the underlying account mutation. `DomainEventPublisher` already swallows
and logs publish errors rather than propagating them — this issue didn't
need to touch that contract, only call into it five more times.

```ts
async create(dto: CreateStaffAccountDto, actorId: string): Promise<Moderator> {
  const temporaryPassword = generateTemporaryPassword();
  const moderator = await this.prisma.moderator.create({ ... });
  await this.staffAuditLog.record({ actorId, action: 'created', targetId: moderator.id, ... });

  const event: StaffAccountCreatedEventV1 = {
    eventType: 'staff.account.created',
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    moderatorId: moderator.id,
    email: moderator.email,
    role: moderator.role,
    actorId,
    temporaryPassword,
    actionId: randomUUID(),
  };
  await this.domainEventPublisher.publish(STAFF_ACCOUNT_CREATED_V1_TOPIC, event, moderator.id);

  return moderator;
}
```

The `actionId: randomUUID()` at each call site is what makes #705's
later consumer dedupe correctly: two `role_changed` events on the same
`moderatorId` (a promotion followed by a later demotion) get two
distinct `actionId`s, so `notification-service`'s `NotificationLog`
unique key — `(entityType, entityId, eventType, moderationQueueEntryId)`
— treats them as two separate notifications rather than colliding the
second against the first's already-sent row.

## Verification

Extended `staff-accounts.service.spec.ts` with mock-`DomainEventPublisher`
assertions for all five methods (correct topic, correct payload shape,
a fresh `actionId` per call), plus real-Redpanda coverage added to
`api/test/domain-events.e2e-spec.ts` confirming each of the five event
types actually lands on its topic when published through the real
`KafkaJS` producer, not just the mocked unit-test path.
