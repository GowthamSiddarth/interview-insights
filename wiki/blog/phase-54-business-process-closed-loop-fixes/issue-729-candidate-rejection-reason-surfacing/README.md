# Phase 54's Fourth Finding — Issue #729: Rejected Candidates Never Learn Why

*Related to Phase 54 — Business-Process Closed-Loop Fixes, tracked
under its own epic (Phase 49, #685) per GitHub's one-parent-per-sub-issue
limit. See `docs/ROADMAP.md` Phase 49 and Phase 54.*

## The gap

Phase 49's issue #688 shipped `rejectionReasonCategory`/`reviewNote` on
`ModerationActionDto` and persisted them on the queue entry — but three
pieces of its own acceptance criteria never actually landed:
`POST /moderation/queue/:id/reject` still accepted a rejection with no
category at all, the rejection notification email still used fixed
boilerplate copy with no mention of why, and `/me/submissions` never
surfaced the reason a candidate could see it. #688 shipped the data
model; nothing downstream of it ever consumed the data. Filed as its
own follow-up (#729) rather than reopening #688, same "post-launch fix"
pattern as #607 — #688 was already merged and closed, and the fourth
finding from this same 2026-08-20 audit pass independently re-derived
the same gap while reviewing Phase 54's business-logic scope.

## The fix: three small, independent pieces closing the same loop

**Require the category on reject.** `ModerationActionDto.rejectionReasonCategory`
stays `@IsOptional()` on the shared DTO — `approve()`/`flag()` must
never require it — so the check lives in `reject()` itself:

```ts
async reject(id: string, dto: ModerationActionDto) {
  if (!dto.rejectionReasonCategory) {
    throw new BadRequestException('rejectionReasonCategory is required when rejecting.');
  }
  return this.review(id, 'rejected', dto);
}
```

**Thread the reason through to the email.** `rejectionReasonCategory`/
`reviewNote` joined all four `*.status_changed.v1` event schemas as an
optional, non-breaking v1 addition — the same shape
`moderationQueueEntryId` already established for exactly this kind of
extension. `notification-service`'s `subjectAndBodyFor()` renders a
human-readable label and the moderator's note when present:

```ts
const reasonLabel = rejectionReasonCategory ? REJECTION_REASON_LABEL[rejectionReasonCategory] : null;
const reasonClause = reasonLabel ? ` The reason given was: ${reasonLabel}.` : '';
```

`reviewNote` is moderator-entered free text now landing in an HTML email
body — the first place this file has ever interpolated variable content
into HTML — so it's HTML-escaped in the `html` field (not the plain-text
one, which needs no escaping) as defense-in-depth, even though a
moderator is trusted staff, not untrusted candidate input.

**Surface it on `/me`.** `rejectionReasonCategory`/`reviewNote` live on
`moderation_queue`, not on the rated entity itself — a new
`fetchLatestRejectionReasons()` batches the lookup with the same
OR-of-refs shape `ModerationService.fetchPriorReviews()` already
established, keeping only the *most recent* reviewed entry per entity
(a candidate's current rejected status corresponds to exactly one queue
entry — the one that set it):

```ts
const rows = await this.prisma.moderationQueueEntry.findMany({
  where: { reviewedAt: { not: null }, OR: refs },
  orderBy: { reviewedAt: 'desc' },
  select: { entityType: true, entityId: true, rejectionReasonCategory: true, reviewNote: true },
});
```

The `/me` page renders it inline on a rejected item; the label mapping
(previously duplicated only in the moderation queue's own page) moved
to a shared `web/src/lib/status.ts` export so both pages read from one
source.

## Verification

Real-Postgres e2e coverage for all three pieces: a reject without a
category 400s and leaves the entry pending (not silently succeeding);
`/me/submissions` shows the category and note on a rejected round
rating while a pending sibling in the same batch shows neither.
`notification-service` gained a dedicated `notification-templates.util.spec.ts`
covering the label mapping, optional-params behavior, and the
HTML-escaping specifically (a raw `<script>` in a note renders escaped
in the HTML body, verbatim in the plain-text one). One real bug caught
by CI, not locally: `scripts/seed-demo-data.ts`'s synthetic-data
generator also calls `reject()` — missed in the initial sweep of call
sites since it lives outside `test/` — and needed the same
`pickRejectionReason()` treatment `pickFlagReason()` already
established for flagged entries.
