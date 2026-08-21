# Phase 53, Issue #788 — GDPR Erasure FK-Violates for Two Candidate Tables

*Part of Phase 53 — Data Integrity, Consistency & Documentation
Reconciliation. See `docs/ROADMAP.md` Phase 53.*

## The gap

`MeService.eraseMe()` deletes every row a candidate owns, in FK-safe
order, ending with the `Candidate` row itself. Two tables added after
this deletion sequence was originally written —
`candidate_password_reset_tokens` (Phase 48's password-auth work) and
`edit_throttle_state` (Phase 49's edit-throttle persistence) — both
carry a `candidateId` foreign key against `Candidate`, and neither was
in the deletion list. Any candidate who had ever reset their password or
edited a single submission would hit a real Postgres FK violation the
moment they tried to erase their account — a 500, not an erasure, on
the one endpoint GDPR compliance depends on actually working.

## The fix: two more deletes, same transaction, correct order

```ts
// me.service.ts — eraseMe()
await tx.round.deleteMany({ where: { processId: { in: processIds } } });
await tx.recruiterInteraction.deleteMany({ where: { processId: { in: processIds } } });

await tx.interviewProcess.deleteMany({ where: { candidateId } });
await tx.candidateVerificationToken.deleteMany({ where: { candidateId } });
await tx.candidatePasswordResetToken.deleteMany({ where: { candidateId } });
await tx.editThrottleState.deleteMany({ where: { candidateId } });
await tx.candidate.delete({ where: { id: candidateId } });
```

Both new deletes land in the same transaction as every other delete
here, and — same as `CandidateVerificationToken` before them — right
before the `Candidate` row itself, since both reference `Candidate`
directly with no further dependents of their own. The fix is small; the
value is in catching that it was missing at all, and in the two tests
that make sure it can't silently regress again as this table list keeps
growing with future phases.

## Verification

Two new real-Postgres e2e cases in `gdpr-erasure.e2e-spec.ts`: one
creates a candidate, has them reset their password (populating
`candidate_password_reset_tokens`), then erases and asserts a clean
204 rather than a 500; the other does the same for an edit-throttle row
via a real submission edit. Both assert the underlying rows are actually
gone afterward, not just that the endpoint returned success.
