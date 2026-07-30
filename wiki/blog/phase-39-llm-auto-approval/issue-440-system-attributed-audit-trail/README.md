# Phase 39, Issue #440 — System-Attributed Auto-Approve Path with a Dedicated Audit Table

*Part of Phase 39 — LLM Auto-Approval for High-Confidence Submissions. See
`docs/ROADMAP.md` Phase 39 and `docs/DECISIONS.md` D71.*

## The gap this closed

Issue #439 computed and stored `autoApprovalEligible: true` on a clean,
high-confidence verdict — but nothing acted on it. This is the issue
that actually reopens D66's "verdict never gates the write" promise,
deliberately and only for that one high-confidence-clean band. Getting
this right mattered more than any other piece of Phase 39: a wrong
auto-approve is real user-facing content published unattended, closer
to D2's defamation-risk territory than to D16/D17's search-indexing
tradeoffs — it isn't self-healing the way a stale index is. D71 treats
the two things this issue builds — routing through the *real*
moderation path, and a durable, non-best-effort audit trail — as
load-bearing parts of the decision, not follow-up hardening.

## Key concept: never a new, parallel path — reuse `ModerationService.approve()` itself

The design question with the highest stakes: does an auto-approval get
its own code path, or does it have to go through the exact same door a
human moderator's click already goes through? D71's answer is
unambiguous — reuse, never duplicate — so that hard constraint #2's
literal text ("every write goes through moderation before it's public")
stays true even once an LLM is allowed to decide the clean band. Only
*who* decides changes.

`ModerationActionDto.reviewedBy` was already a free-text field (there's
no real auth/admin-user system yet, the same gap the DTO's own comment
documents) — so a fixed system-actor string slots in with zero new
plumbing:

```ts
export const AUTO_APPROVAL_SYSTEM_ACTOR = 'system:ai-auto-approval';
```

```ts
if (result.verdict.autoApprovalEligible === true) {
  await this.autoApprove(entityType, entityId, result);
}
```

```ts
private async autoApprove(
  entityType: TriageableEntityType,
  entityId: string,
  result: VerdictResult,
): Promise<void> {
  const queueEntry = await this.prisma.moderationQueueEntry.findFirst({
    where: { entityType, entityId, reviewedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!queueEntry) {
    this.logger.warn(/* ... leaving it advisory-only */);
    return;
  }

  await this.moderationService.approveWithAudit(
    queueEntry.id,
    { reviewedBy: AUTO_APPROVAL_SYSTEM_ACTOR },
    { entityType, entityId, promptContent: result.promptContent, responseText: result.responseText,
      verdict: result.verdict, confidence: result.confidence, model: result.model },
  );
}
```

`approveWithAudit()` is a thin new entry point on `ModerationService`,
but it still calls the same private `review()` every `approve()`/
`reject()`/`flag()` call already routes through — the queue entry gets
`reviewedAt`/`reviewedBy` set, the entity's own `status` flips to
`approved`, search indexing fires, exactly like a human click. The
*only* addition is one extra write inside the same transaction.

## Key concept: the audit row and the approval commit together, or neither does

The alternative to a dedicated table — extending the existing
`moderationVerdict` JSONB column with a `decidedBy`/`decidedAt` pair —
was explicitly rejected at the kickoff brainstorm. That column is
mutable: a later human override or re-triage overwrites it, and the
record of *why* the system auto-approved something would disappear
along with it. `ai_auto_approval_audit` is append-only and separate on
purpose:

```prisma
model AiAutoApprovalAudit {
  id                     String               @id @default(uuid()) @db.Uuid
  entityType             ModerationEntityType @map("entity_type")
  entityId               String               @map("entity_id") @db.Uuid
  moderationQueueEntryId String               @map("moderation_queue_entry_id") @db.Uuid
  promptContent          String               @map("prompt_content")
  responseText           String               @map("response_text")
  verdict                Json
  confidence             Float
  model                  String
  decision               ModerationStatus     @default(approved)
  createdAt              DateTime             @default(now()) @map("created_at") @db.Timestamptz
}
```

`moderationQueueEntryId` is a real foreign key (unlike the polymorphic
`entityType`/`entityId` pair `moderation_queue` itself uses) — queue
entries are never deleted once resolved, so this is the one place
record identity is stable enough to reference directly. The row is
written inside `review()`'s existing `$transaction`, not as a
best-effort follow-up the way OpenSearch indexing is (D16/D17):

```ts
const updatedEntry = await this.prisma.$transaction(async (tx) => {
  const updated = await tx.moderationQueueEntry.update({ /* ... */ });
  // status update on the entity itself ...
  if (audit) {
    await tx.aiAutoApprovalAudit.create({ data: { /* entityType, entityId,
      moderationQueueEntryId: id, promptContent, responseText, verdict,
      confidence, model */ } });
  }
  return updated;
});
```

Approved-without-audit and audited-without-approve are both states
that must never exist. Putting the audit insert inside the same
`$transaction` as the approval it documents is what makes that
guarantee true at the database level, not just by convention.

## Step-by-step: what actually got built and verified

1. Prisma migration adding `ai_auto_approval_audit` (FK to
   `moderation_queue`, indexed on `(entity_type, entity_id)`).
2. `ModerationService.approveWithAudit()` — routes through the same
   `review()` every other decision uses, with one extra transactional
   insert.
3. `AiModerationService.autoApprove()` — looks up the entity's pending
   queue entry and calls `approveWithAudit()`, attributed to
   `system:ai-auto-approval`. A missing queue entry or a DB error here
   degrades to advisory-only (the verdict is already stored from #439;
   only the *action* on it is skipped) — never allowed to fail the
   original write.
4. 66 unit tests passing across `moderation.service.spec.ts` and
   `ai-moderation.service.spec.ts`, covering the routing, the
   transactional audit write, and every degrade-to-advisory-only path.
5. `prisma migrate deploy` verified clean against a real dev database.

## What this enabled

The clean/high-confidence band of submitted content can now be
published without a human touching it — durably audited, routed
through the exact same code path a moderator's own click uses. The two
issues that follow in this phase are entirely about operating this
safely: #441 gives it a kill switch, #442 makes sure a triage that
silently never completes doesn't leave a submission stuck in limbo
forever.
