# Phase 50, Issue #698 — `company.created.v1`/`company.status_changed.v1` Events + `notification-service` Consumption

*Part of Phase 50 — Company Creation Request Lifecycle.
See `docs/ROADMAP.md` Phase 50, D104.*

## The gap

A candidate who submitted, got approved, or got rejected on a company
request received exactly zero emails about any of it — `company` had
always been explicitly out of scope for the `*.created`/`*.status_changed`
event family (D53's original "moderated entity types" list never
included it, since a create-company request wasn't one of the three
rated/reviewed entities #331/#332 were scoped to). Both switch branches
in `ModerationService` were permanent, deliberate no-ops.

## The fix: two new event types, reusing everything else unchanged

New schemas, structurally identical to the three existing entity types
minus a `companyId`-vs-`entityId` split (the entity *is* the company
here):

```ts
export interface CompanyCreatedEventV1 {
  eventType: 'moderation.company.created';
  eventVersion: 1;
  occurredAt: string;
  companyId: string;
  candidateId: string;
  status: 'pending';
  isResubmission?: boolean;       // present for type consistency, never set
  moderationQueueEntryId?: string; // — see below
}
```

The two now-live switch cases fetch the company and skip publishing
entirely when there's no requester to notify — the same "nothing to act
on" pattern `#696`'s nullable `candidateId` already established elsewhere:

```ts
case 'company': {
  const c = await this.prisma.company.findUniqueOrThrow({ where: { id: entityId } });
  if (!c.candidateId) return; // seed/admin-created — no requester
  const event: CompanyCreatedEventV1 = {
    eventType: 'moderation.company.created',
    eventVersion: 1,
    occurredAt,
    companyId: c.id,
    candidateId: c.candidateId,
    status: 'pending',
  };
  await this.domainEventPublisher.publish(COMPANY_CREATED_V1_TOPIC, event, c.id);
  return;
}
```

`CompaniesService.create()` gained the matching `publishCreatedEvent()`
call after commit. `update()` (#697) deliberately does *not* — a company
resubmission produces no ack email, only the eventual `status_changed`
one, a scope boundary #697 had already drawn before this issue even
started.

On the consumer side, extending `notification-service` turned out to
need almost no new code: `entityTypeFor()`/`entityIdFor()`'s own
switches were the *only* company-specific branches anywhere in the
service. Every other piece — `notificationFor()`'s created-vs-
status_changed branching, the idempotency check, `pendingReviewSubjectAndBody()`/
`subjectAndBodyFor()`'s templates, and critically Phase 49's
`moderationQueueEntryId`-keyed dedup (#686/#687) — is generic across
entity types and just started working for `company` the moment its
topics joined the subscription list. That last part mattered concretely:
`Company` already gets `reenqueue()`d on a `PATCH` edit (#697), so a
company *can* receive two `status_changed` events for the same
`companyId` — reusing #687's fix from day one meant this issue couldn't
reintroduce the exact dedup bug D104's audit found in the first place.

Rejection emails use the existing generic boilerplate
(`subjectAndBodyFor('rejected')`), same as every other entity type —
reason-in-email surfacing is #729's still-open scope, not #698's; adding
it only for company ahead of the original three types would have been
an inconsistent partial implementation of a different issue.

## Verification

Six new unit tests in `notification-consumer.service.spec.ts`: created,
approved, rejected, the `flagged` no-op, redelivery idempotency, and a
resubmission's decision correctly *not* colliding with a prior decision's
dedup row. Two new real-infrastructure e2e cases — one in
`api/test/domain-events.e2e-spec.ts` against a real Redpanda broker
(company submission and approval each produce their own event), one in
`notification-service/test/notifications.e2e-spec.ts` against real
Redpanda/Postgres/Mailpit (both emails actually land, in order, as two
distinct Mailpit messages).
