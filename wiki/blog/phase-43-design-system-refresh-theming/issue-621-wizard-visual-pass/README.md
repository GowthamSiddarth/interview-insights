# Phase 43, Issue #621 — Wizard Visual Pass: Completion Progress + Rated/Unrated Icons

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43.*

## The gap this closed

The review wizard's `StepNavigator` (Phase 26's free-jump sidebar —
every step a clickable item, no forced linear order) told a candidate
*where* they were, via the active item's highlight, but nothing about
*how much of the review was actually done*. This issue added that
signal without touching the navigation model itself.

## Key concept: position and completion are different questions

```tsx
const ratedCount =
  draft.rounds.filter((s) => s.round.rating).length +
  draft.recruiterInteractions.filter((s) => s.interaction.rating).length +
  (draft.overallReview ? 1 : 0);
const totalCount = draft.rounds.length + draft.recruiterInteractions.length + 1;
```

The sidebar already answers "where am I" — the active item is
highlighted. It has never answered "how much is left," and a linear
"Step 3 of 6" indicator would have been redundant with information
the sidebar already shows, while adding nothing new. Counting *rated*
steps instead of *visited* steps answers a genuinely different
question: a candidate could visit every step without rating any of
them, or jump straight to round 4 and rate it first. `'process'` and
`'review'` are structural steps, not ratings, and are deliberately
excluded from both the count and the per-step icon — a misleading
always-empty or always-filled icon on a step that was never going to
have a "rating" would be worse than no icon at all.

## Key concept: three tests that encode the actual edge cases, not just the happy path

```tsx
it('counts process/review as structural, not part of the rated total', …);
it('counts a round as rated only once it actually has a rating attached', …);
it('reflects the overall review once it exists', …);
```

The second test is the one that matters most: a round can exist in a
draft with no rating yet (adding a round and rating it are two
separate actions in this wizard), so "has a round" and "round is
rated" are different conditions a naive `draft.rounds.length` count
would conflate. Writing the test against a draft with one rated round
and one unrated round — rather than just an all-rated or all-empty
fixture — is what actually exercises that distinction instead of
passing by coincidence.

## Verification

Full suite green (234/234, three new tests for the completion math).
Real-browser check needed a working draft to render against, which
meant seeding `localStorage` directly with a `ProcessDraft` object
matching the app's own storage schema (`interview-insights:drafts:v1`)
and loading `/write-review?draftId=…` — sidesteps the wizard's own
round-type-registry API call, which also hits the local CORS gap, by
never needing that fetch to succeed for the navigator itself to
render. The resulting screenshot showed a 3-of-5 progress bar at the
correct 60% width, with green-check/gray-circle icons matching each
step's actual rated state, in both themes.
