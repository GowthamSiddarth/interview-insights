# Phase 28, Issue #306 — A Modal for the Moment "Next" Would Skip Past Adding a Round

*Part of Phase 28 — Wizard UX Refinements. Epic #280 reopened for this
and two related follow-ons. See `docs/ROADMAP.md` Phase 28.*

## The exact moment the confusion happens

Issue #283's "Next" button walks a fixed sequence — process details,
every round, every recruiter step, overall review, review & submit.
The sidebar's own "Add a round" control (a dropdown plus a button) has
always existed alongside it, but it's easy to never notice: a
candidate who just keeps clicking Next can go from Process Details
straight to a recruiter step, or straight to the review screen, having
never been offered the chance to add a round at all. The confusion
isn't that adding a round is *hard* — it's that Next, the button doing
most of the navigating, never once mentions it.

## Key concept: intercept only at the actual boundary

The fix isn't showing a prompt on every Next click — that would be
its own new annoyance for a candidate navigating between rounds they've
already added. It only matters at one specific transition: the moment
Next would leave "round-adding territory" for good. Concretely, that's
exactly two situations: clicking Next from Process Details when zero
rounds exist yet, or clicking Next from the *last* round in the list.
Everywhere else — between two existing rounds, from a recruiter step,
from overall review — Next keeps behaving exactly as issue #283 built
it.

```ts
function shouldOfferAddRoundModal(draft, currentStepId) {
  if (currentStepId === 'process') return draft.rounds.length === 0;
  const lastRound = draft.rounds[draft.rounds.length - 1];
  return lastRound?.clientId === currentStepId;
}
```

## Key concept: the modal needs three exits, not two

The first pass at this modal offered two choices — add another round,
or finish and go straight to the review screen. That's the two
outcomes the original request asked for by name. But it broke an
existing test the moment a recruiter step or overall review already
existed and hadn't been visited yet: there was no way to say "no more
rounds, just continue to what's next," only "skip everything and go to
review" or "add one." The modal needed a third action — "No,
continue" — that does exactly what Next would have done before this
modal intercepted it, preserving the original step-by-step promise for
candidates who already have later steps filled in and just want to
keep moving through them in order.

## Key concept: blocking Next on the wrong issue would defeat its own purpose

Next was also given the same validation gate Submit already has —
block entirely, no navigation, if the current step has an unresolved
issue. That ran straight into a subtle conflict with the sibling issue
#307's new "at least one round" rule: that rule is attached to
`stepId: 'process'` (so its Fix link on the review screen goes
somewhere useful), which meant Next's own step-issue check saw it too
— and blocked Next from Process Details whenever no round existed
yet, which is *exactly* the situation this modal exists to help with.
A candidate would have been stuck: Next refuses to move because there's
no round, and Next is the only thing that was supposed to offer adding
one.

The fix: give every `DraftValidationIssue` a stable `id`, separate from
`stepId`, and exclude `'at-least-one-round'` specifically from the
set of issues that block Next:

```ts
const currentStepIssues = validationIssues.filter(
  (issue) => issue.stepId === activeStepId && issue.id !== 'at-least-one-round',
);
```

The distinction that makes this the right fix, not a special case: not
every issue attached to a step is a defect of that step's own content.
Round rating bounds, recruiter identifiers, role title — those are all
genuinely wrong data sitting on the step you're trying to leave.
"There are no rounds yet" isn't a defect of Process Details; it's a
whole-draft completeness fact, and the fix for it is precisely to
click Next and let the modal help — not to be blocked from clicking
Next at all.

## What this enabled

A candidate using Next end to end now gets offered the chance to add a
round at exactly the two points it would otherwise be easy to miss,
without that offer ever getting in the way of simply continuing to a
step they've already started. The free-jump step navigator underneath
all of this is untouched — this is purely an assist layered on top of
the sequential path.
