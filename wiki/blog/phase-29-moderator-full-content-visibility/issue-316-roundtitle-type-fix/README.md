# Phase 29, Issue #316 — Fix `ModerationQueueEntity.roundTitle`'s Type

*Part of Phase 29 — Moderator Full Content Visibility & Submission
Consistency. See `docs/ROADMAP.md` Phase 29.*

## The gap

`web/src/lib/api.ts`'s `ModerationQueueEntity.roundTitle` was typed
`string` (no `| null`), even though the backend sets it from
`Round.title`, which has been a genuinely nullable column since Phase
28 issue #287 (a round's title became optional, formatted as
"{Type} - {Title}" with the title segment omitted when absent). The
other two read surfaces exposing a round's title —
`CompanyReviewItem.roundTitle` and `MySubmissionRoundRating.roundTitle`
— already correctly typed this `string | null`. Not a runtime bug
today (`formatRoundLabel()` already accepts `string | null |
undefined`), but a real type-safety gap: nothing stopped a future
change from assuming `roundTitle` is always a string and shipping a
crash the type system should have caught.

## Why this issue closed without its own PR

A read-only investigation into moderator content-visibility gaps
(the same one that surfaced issue #315's original scope and issue
#317's rate-limit gap) found this type mismatch as a third, independent
item — worth its own issue since it's a different kind of problem
(type safety, not missing data). But issue #315's implementation
touched the exact same `ModerationQueueEntity` interface anyway, adding
`processId`/`roundDescription`/`roundTypeMetadata`/
`roundScheduledDurationMinutes` fields. Since the file and the type
were already open for editing, the one-line fix rode along:

```diff
-  // round_rating
-  roundTitle?: string;
+  // round_rating — full submitted content (GitHub issue #315), not just
+  // the highlighted score fields.
+  roundTitle?: string | null;
```

By the time issue #315 merged (commit `a5fda25`), this issue's entire
acceptance criterion was already satisfied. Verifying both sides
confirmed it: the backend (`moderation.service.ts`) already declared
and set `roundTitle?: string | null` from `r.round.title`, matching
`CompanyReviewItem`/`MySubmissionRoundRating`'s existing correct
typing exactly.

## What this illustrates about planning a phase's issues independently

Filing three separate, cleanly-scoped issues from one investigation
(#315, #316, #317) was still the right call, even though one of them
turned out to be free — each represented a genuinely distinct kind of
problem (missing data, type drift, wrong counting unit), and treating
them as one bundled issue would have made the eventual PR harder to
review and its acceptance criteria muddier. The fact that #316 got
resolved as a side effect of #315's own work is a normal, healthy
outcome of touching related code in one pass — not a sign the issue
shouldn't have existed. Closed on GitHub with the diff cited directly,
no dedicated PR, `docs/ROADMAP.md`/`CLAUDE.md` checked off in the same
docs-only pass that also handled #315's status update.
