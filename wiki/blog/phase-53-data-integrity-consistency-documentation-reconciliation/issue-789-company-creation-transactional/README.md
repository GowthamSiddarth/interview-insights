# Phase 53, Issue #789 — Company Creation Isn't Transactional With Its Moderation Enqueue

*Part of Phase 53 — Data Integrity, Consistency & Documentation
Reconciliation. See `docs/ROADMAP.md` Phase 53.*

## The gap

Every other moderated write path in this app enqueues its
`moderation_queue` row inside the same transaction as the entity
create — D12's documented pattern, followed consistently by
`RoundRatingsService`, `RecruiterRatingsService`, `OverallReviewsService`.
`CompaniesService.create()` was the one exception: it created the
`Company` row, then called `moderationService.enqueue()` as a separate,
un-transactional follow-up call. If the process crashed, or the enqueue
call itself threw, between those two steps, the result was a `Company`
row stuck permanently at `status: 'pending'` with no `moderation_queue`
entry ever pointing at it — invisible to every moderator, un-reviewable,
forever.

## The fix: wrap both in `$transaction`

```ts
async create(dto: CreateCompanyDto, candidateId?: string) {
  const pendingDuplicate = await this.prisma.company.findFirst({
    where: { slug: dto.slug, status: 'pending' },
  });
  if (pendingDuplicate) {
    throw new ConflictException(/* ... */);
  }

  const company = await this.prisma.$transaction(async (tx) => {
    const company = await tx.company.create({ data: { ...dto, candidateId } });
    await this.moderationService.enqueue('company', company.id, tx);
    return company;
  });

  // Best-effort, after commit — unaffected by this fix.
  await this.moderationService.indexForSearch('company', company.id);
  await this.moderationService.publishCreatedEvent('company', company.id);
  return company;
}
```

`ModerationService.enqueue()` already accepted an optional transaction
client parameter (`tx: PrismaTransaction = this.prisma`) — every other
write path was already passing it through; `CompaniesService.create()`
simply wasn't. The two best-effort, after-commit calls
(`indexForSearch`/`publishCreatedEvent`) stay exactly where they were,
outside the transaction — D16/D17's existing reasoning for those was
already correct and untouched by this fix.

## Verification

A new unit test asserts `create()` and `enqueue()` are called through
the same `$transaction` callback, mocking a failure inside the
transaction and confirming no `Company` row survives it (the whole
transaction rolls back — no orphaned pending company, no partial
enqueue). The existing company-creation e2e coverage continues to pass
unchanged, since the externally observable behavior for the success
path is identical; only the crash-between-steps failure mode changed,
which is inherently hard to reproduce in a black-box e2e test and is
instead covered at the unit level by mocking the transaction boundary
directly.
