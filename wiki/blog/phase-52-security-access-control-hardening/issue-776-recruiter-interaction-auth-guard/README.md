# Phase 52, Issue #776 — No Auth Guard on Recruiter-Interaction Creation

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52, `docs/DECISIONS.md` D112.*

## The gap

`POST /processes/:processId/recruiter-interactions` had the identical
gap #775 found on `Round` creation: no guard, no ownership check,
`processId` taken straight from the URL. Same root cause too — D31
enumerated `candidateId`-bearing tables and `RecruiterInteraction`
doesn't have one either, so it fell through the same crack.

This one had an extra wrinkle. `RecruiterInteractionsService.create()`
resolves the interaction's `Recruiter` via `findOrCreate()` — if the
identifier (an email or name) hasn't been seen for this company before,
it mints a brand-new `Recruiter` row. Unauthenticated access didn't just
mean "attach a fake interaction to someone else's process" — it meant
an attacker could freely create `Recruiter` rows for any company,
polluting the internal per-company recruiter directory this app uses
for de-duplication and generated-label assignment (CLAUDE.md hard
constraint #1).

## The fix: same pattern as #775, gated before the side effect

```ts
// recruiter-interactions.controller.ts
@Post()
@UseGuards(CandidateJwtAuthGuard)
create(
  @Param('processId', ParseUUIDPipe) processId: string,
  @CurrentCandidateId() candidateId: string,
  @Body() dto: CreateRecruiterInteractionDto,
) {
  return this.recruiterInteractionsService.create(processId, candidateId, dto);
}
```

```ts
// recruiter-interactions.service.ts — ownership checked before
// findOrCreate(), so an unauthorized caller can't mint Recruiter rows either
create(processId: string, candidateId: string, dto: CreateRecruiterInteractionDto) {
  return this.prisma.$transaction(async (tx) => {
    const process = await tx.interviewProcess.findUniqueOrThrow({
      where: { id: processId },
      select: { companyId: true, candidateId: true },
    });
    if (process.candidateId !== candidateId) {
      throw new ForbiddenException('You can only add recruiter interactions to your own process.');
    }
    const recruiter = await this.recruitersService.findOrCreate(process.companyId, dto.recruiterIdentifier, tx);
    return tx.recruiterInteraction.create({ data: { processId, recruiterId: recruiter.id } });
  });
}
```

The ownership check runs *before* `findOrCreate()` inside the same
transaction — an unauthorized request now fails before it can touch the
`Recruiter` table at all, not after.

## Verification

Same real-Postgres e2e shape as #775: unauthenticated 401s, cross-candidate
403s, verified in `api/test/sessions-on-write-path.e2e-spec.ts`. Every
existing recruiter-interaction e2e call site across the suite needed a
session cookie threaded through, caught mechanically by the test suite
once the guard landed.
