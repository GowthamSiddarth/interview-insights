# Phase 28, Issue #283 — A "Next" Button Alongside Free-Jump Navigation

*Part of Phase 28 — Wizard UX Refinements. See `docs/ROADMAP.md` Phase 28
and epic #280.*

## Why the flashcard navigator wasn't the whole answer

Issue #254's flashcard step navigator was explicitly designed to be
free-jump: click any step, in any order, at any time — a deliberate
rejection of a rigid one-way flow. That's still the right default for
a candidate revisiting or reordering their draft. But it has a real
cost for the common, boring case: filling out a fresh draft top to
bottom. Finishing round 1 and wanting round 2 meant reaching back to
the step list every time, an extra motion for the single most frequent
action in the whole flow.

## Key concept: additive, not a replacement

The fix isn't to make navigation linear — it's to add a shortcut for
the linear path *on top of* the existing free-jump list, which stays
exactly as-is. A "Next" button appears below every step's own content
and advances through one fixed sequence: process details, then every
round (in array order), then every recruiter step (in array order),
then the overall review, then Review & Submit. On the last step it
simply doesn't render, since there's nowhere further to go.

## Key concept: computed live, never a stale snapshot

The sequence isn't stored anywhere — `getNextStepId(draft,
currentStepId)` rebuilds the ordered list of step IDs from the
*current* draft on every call:

```ts
function getNextStepId(draft: ProcessDraft, currentStepId: string): string | null {
  const sequence = [
    'process',
    ...draft.rounds.map((s) => s.clientId),
    ...draft.recruiterInteractions.map((s) => s.clientId),
    'overall',
    'review',
  ];
  const index = sequence.indexOf(currentStepId);
  return index === -1 || index === sequence.length - 1 ? null : sequence[index + 1];
}
```

That means adding a round mid-flow, jumping ahead via the navigator,
then clicking Next from wherever you land, always produces the
correct "what comes after this" answer — there's no separate state to
fall out of sync with the draft itself.

## Step-by-step: what actually got built and verified

1. `getNextStepId()` added to `page.tsx`, computed once per render
   alongside `validationIssues`.
2. A "Next" button rendered after every step's content except
   `'review'`, wired to `setActiveStepId(nextStepId)`.
3. One new component test walking the full sequence from a fresh
   draft — process details, a round, a recruiter step, overall review,
   review & submit — confirming each click lands on the right step and
   that no Next button exists on the final one.

## What this enabled

Filling out a draft top to bottom is now a single repeated action
(fill, click Next) instead of alternating between filling a step and
reaching for the navigator — while jumping around to revisit or
reorder anything still works exactly as issue #254 built it.
