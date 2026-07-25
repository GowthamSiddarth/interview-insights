# Phase 28, Issue #282 — Round Ratings Default to Available

*Part of Phase 28 — Wizard UX Refinements. See `docs/ROADMAP.md` Phase 28
and epic #280.*

## Why this one is a one-line fix with an outsized effect

`RoundStepForm`'s "I have a rating for this round" checkbox already
worked correctly for every round type — nothing was broken. The
problem was the default: a newly added round started with `rating:
undefined`, so a candidate had to remember to opt in on every single
round they added, even though in practice almost every rated round
gets rated. One extra click, repeated across every round in a
multi-round interview, adds up to real friction for no real benefit —
the schema and every backend path already tolerate a round with no
rating (issue #260), so defaulting to "has a rating" doesn't remove
that capability, it just flips which state requires a deliberate
action.

## The fix

`handleAddRound()` in `page.tsx` now attaches the same default values
`toggleRating(true)` already used elsewhere (`{ difficulty: 3, fluency:
3, clarity: 3, focus: 3 }`) at the moment a round is created, instead
of leaving `rating` unset:

```ts
addRoundStep(activeDraft, {
  sequenceNumber: nextSequenceNumber,
  roundType,
  rating: { difficulty: 3, fluency: 3, clarity: 3, focus: 3 },
});
```

The checkbox itself, and its ability to opt a round *out* of having a
rating, are completely unchanged — this only changes what a round
looks like the instant it's created.

## What this enabled

A candidate filling out a multi-round interview now sees every round's
rating section open by default, ready to adjust numbers rather than
first finding and clicking a checkbox. Opting out (for a round they
genuinely can't rate) is still one click away, same as before — the
common case just got faster without removing the uncommon one.
