# Phase 50, Issue #697 — PATCH Edit Endpoint for a Candidate's Own Company Request

*Part of Phase 50 — Company Creation Request Lifecycle.
See `docs/ROADMAP.md` Phase 50, D104.*

## The gap

Even after #696 let a rejected request's slug be reused, there was still
no way to actually *edit* a rejected company request — a candidate's
only option was to submit an entirely new request from scratch, losing
any context (and, before #696, often blocked outright by the slug
collision anyway). No `PATCH /companies/:id` endpoint existed at all.

## The fix

`CompaniesService.update()`, deliberately mirroring
`RoundRatingsService.update()`'s reset-to-pending + `reenqueue()` shape
— with one difference the issue's acceptance criteria called out
explicitly, even though the issue body's own looser description didn't:

```ts
async update(id: string, candidateId: string, dto: CreateCompanyDto) {
  const company = await this.prisma.company.findFirstOrThrow({ where: { id } });
  if (company.candidateId !== candidateId) {
    throw new ForbiddenException('You can only edit your own company request.');
  }
  if (company.status === 'approved') {
    throw new ForbiddenException('An approved company can no longer be edited.');
  }

  const updated = await this.prisma.$transaction(async (tx) => {
    const updated = await tx.company.update({ where: { id }, data: { ...dto, status: 'pending' } });
    await this.moderationService.reenqueue('company', id, tx);
    return updated;
  });
  await this.moderationService.indexForSearch('company', id);
  return updated;
}
```

Unlike a rating or review — where a candidate can always revise their
own content, even after it's approved, reverting it back to `pending` —
a company is public/canonical once approved. Other candidates may
already have submitted interview processes against it; letting the
original requester silently pull it back into a draft state would be
disruptive in a way an approved rating's own re-edit never is. So this
endpoint adds an explicit status guard on top of the ownership check:
`pending`/`rejected` are editable, `approved` is a 403 even for the
owning candidate.

The route is guarded by `EditThrottleGuard` — the same
repeated-edit-driven-re-enqueue abuse throttle `RoundRating`/
`RecruiterRating`/`OverallReview` already share, now extended to
`Company` too by importing `EditThrottleModule` into `CompaniesModule`.
No `publishCreatedEvent()` resubmission-ack call here, unlike the other
three types' own `update()` since #692 — a company resubmission ack
email is explicitly out of scope for this issue (and, per #698's own
blog post, stays out of scope there too).

## Verification

`companies.service.spec.ts` gained five new unit tests: resubmitting a
pending request, resubmitting a rejected one, a non-owner 403, a 403 for
an unattributed (seed/admin-created) company, and a 403 for an approved
company even from its own requester. A new e2e `describe` block in
`company-moderation.e2e-spec.ts` proves the same five cases end to end
against real Postgres, including confirming a resubmission's queue entry
id is genuinely distinct from the original rejected one — the actual
proof that `reenqueue()` fired, not just that the HTTP call returned 200.
