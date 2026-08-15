# Phase 49, Issue #688 — `rejectionReasonCategory` + `reviewNote` on `ModerationActionDto`

*Part of Phase 49 — Resubmission Loop & Rejection Feedback.
See `docs/ROADMAP.md` Phase 49, D104.*

## The gap

A moderator rejecting a submission had no structured way to say *why*.
`ModerationActionDto` carried only an optional free-text `reviewedBy`
label — nothing captured a category a candidate (or a later moderator
looking at resubmission history, #691) could actually act on.

## The fix

Two new fields on the shared action DTO, and a matching enum on the
queue-entry model:

```ts
export class ModerationActionDto {
  @IsOptional()
  @IsString()
  reviewedBy?: string;

  @IsOptional()
  @IsEnum(ModerationRejectionReason)
  rejectionReasonCategory?: ModerationRejectionReason;

  @IsOptional()
  @IsString()
  reviewNote?: string;
}
```

```prisma
enum ModerationRejectionReason {
  low_quality
  guideline_violation
  identifying_information
  spam_or_promotional
  inaccurate_or_unverifiable
  other
}
```

Both fields live on the *shared* DTO rather than a `reject()`-only
subclass — `reviewedBy` already established that "one DTO, only some
fields meaningful for some decisions" shape, and `reviewNote` in
particular isn't gated to rejections at all (a moderator can annotate an
approval too). `ModerationService.review()` just persists whatever the
caller provides, unconditionally:

```ts
data: {
  reviewedAt: new Date(),
  reviewedBy: dto.reviewedBy,
  flagReason,
  rejectionReasonCategory: dto.rejectionReasonCategory,
  reviewNote: dto.reviewNote,
},
```

Deliberately *not* required-when-rejected at this layer, despite the
original issue text asking for a 400 on a category-less rejection — that
part, along with surfacing the reason in the rejection email and on
`/me`, never actually shipped in this pass. It's tracked as a follow-up
(#729, filed under this same epic) once the gap was noticed later in the
phase, rather than silently expanding this issue's own scope after the
fact.

## Verification

New unit tests in `moderation.service.spec.ts` assert `reject()`
persists both fields onto the queue entry when the DTO carries them, and
that `approve()`/`flag()` accept (but don't require) `reviewNote` too.
A hand-authored migration added the enum and the two nullable columns.
