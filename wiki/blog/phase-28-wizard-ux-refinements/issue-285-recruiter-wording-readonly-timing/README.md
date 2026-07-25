# Phase 28, Issue #285 — Recruiter Step Wording + Read-Only Timing

*Part of Phase 28 — Wizard UX Refinements. See `docs/ROADMAP.md` Phase 28
and epic #280.*

## Two small findings from the same step

Both fixes here came from actually using the recruiter touchpoint step
end to end: the wording ("before rounds"/"after rounds") read
awkwardly next to the more natural "pre-interview"/"post-interview,"
and the step's own "When was this?" control was a second, redundant
way to set something the candidate had already decided.

## Key concept: a value chosen once shouldn't need a second control

The step navigator has always had two distinct buttons — "+ Recruiter
(before rounds)" and "+ Recruiter (after rounds)" — that create a
touchpoint with its `timing` already fixed. But `RecruiterStepForm`
also rendered an editable `<select>` for the exact same value, right
inside the step. Two controls for one piece of state is confusing on
its own (which one is authoritative if they disagree?) and unnecessary
here specifically, since the add-time choice is exactly what
determines the step's chronological placement on the review screen
(issue #255's `timing: 'start' | 'end'`). The fix removes the second
control entirely: the form now shows a plain, read-only line —
"When was this? **Before my interview**" — reflecting the timing
already chosen, with no way to change it in place. (Removing a step
and re-adding it via the correct button is still how you'd change your
mind, which is a real but rare enough path not to need its own UI.)

## Key concept: rename once, everywhere

"Before/after rounds" appeared in three places — the two add-step
buttons, the step navigator's per-step list, and the review screen's
step summaries — and all three needed the same rename to
"pre-interview"/"post-interview" to actually read consistently. This
is the kind of change that's trivial per-site and easy to leave
half-done if done ad hoc; doing it as one issue with its own
acceptance criteria kept all three in sync.

## What this enabled

The recruiter step now says one true thing about its own timing
instead of offering an editable field that duplicated a decision
already made, and the "pre/post-interview" wording reads naturally
everywhere a candidate encounters it in the wizard.
