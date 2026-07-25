# Phase 28, Issue #319 — One Way to Add a Round, Not Two

*Part of Phase 28 — Wizard UX Refinements. Epic #280 reopened for this
follow-on. See `docs/ROADMAP.md` Phase 28.*

## Two working paths is its own kind of confusion

Issue #306 built a modal that opens at the exact moment "Next" would
otherwise skip past adding a round — a real fix for a real gap. But it
left the sidebar's original "Add a round" control (a dropdown plus a
button) sitting right next to it, unchanged. Two controls that both
do the same thing isn't neutral: it's a second thing to notice, a
second place the same information (round type) has to be entered, and
a genuine question a candidate might reasonably ask — "which one am I
supposed to use?" The fix here isn't adding a third explanation of the
difference; it's removing the redundant one.

## Key concept: removing a shortcut doesn't remove a capability, if the remaining path still reaches everywhere

The natural worry when deleting a UI control is "can a candidate still
do the thing at all, from every state they might be in?" Concretely:
if someone is viewing Round 1 of 2 and wants to add a third round,
they no longer have a button available *right there*. But the
capability isn't gone — `shouldOfferAddRoundModal()` (issue #306)
already offers the modal specifically when Next is clicked from
Process Details with no rounds yet, or from the *last* round. Adding a
third round is still one action away: navigate to Round 2 (already
one click, via the free-jump step navigator) and click Next. The
sidebar control never covered a case the modal-plus-navigator
combination can't also reach — it was purely redundant, not covering
a distinct scenario.

## Key concept: a default value that requires a decision is more honest than one that requires noticing

The round-type select previously defaulted to "Coding" — a reasonable
first guess, but one a candidate could click straight through without
ever actually deciding what round they were adding. Defaulting to an
unselected "None" and disabling "Add new round" until a real choice is
made trades one click of friction for a guarantee: whatever round gets
created was the type the candidate actually meant, not whatever
happened to be first alphabetically (or, after this issue, first by
however the list is ordered — which is itself now meaningful: Tech
Screening, Assessment, and Take-home lead the list because those are
typically the earliest steps in a real interview loop, not because of
where they happened to fall in an enum declaration).

## Key concept: renaming a button and changing what it does are two different changes, done together deliberately

"No, continue" is renamed to "Cancel," which sounds like a pure
copy-edit — but its behavior changed too, and that's the part that
actually mattered. The old button advanced to whatever Next would have
done normally (the next recruiter step, overall review, whatever
existed). Once the sidebar's direct control was gone, that "continue
forward" behavior became something the button was doing *instead of*
what a Cancel action should do: back out, touch nothing, leave the
candidate exactly where they were. Keeping the old navigation behavior
under a new label would have been the confusing outcome here — a
button named "Cancel" that quietly moves you somewhere. The fix
matches the label to the behavior a candidate would actually expect
from it.

## What this enabled

Adding a round now has exactly one entry point, reachable from
anywhere in the draft via the same two steps every time (get to the
last round or Process Details, click Next), with a select that forces
an actual decision instead of defaulting through one, and a Cancel
button that means cancel.
