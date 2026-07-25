# Phase 28, Issue #307 — Modular Validation, a New Hard Rule, and a Soft Reminder

*Part of Phase 28 — Wizard UX Refinements. Epic #280 reopened for this
and two related follow-ons. See `docs/ROADMAP.md` Phase 28.*

## Two new rules, requested together, that need different treatment

Two submission-time asks arrived in the same message: never accept a
submission with zero rounds, and remind — but never force — a
candidate who hasn't logged a recruiter touchpoint from before and
after their interview. These sound similar (both are "check the whole
draft before Submit") but they need genuinely different mechanisms:
one has to block Submit outright, the other has to *not* block it
under any circumstance, just ask "are you sure?" once. Building both
into the same blocking `validateDraft()` function would have made the
soft one accidentally hard.

## Key concept: two parallel rule lists, not one bigger function

`validateDraft()` had already grown into one function checking five
different things in sequence — role title, round rating bounds,
recruiter identifiers and bounds, overall review bounds. Rather than
add a sixth `if` block (and inevitably a seventh, someday), it's now a
list of small independent functions combined with `.flatMap()`:

```ts
const VALIDATION_RULES: ValidationRule[] = [
  validateRoleTitle,
  validateAtLeastOneRound,
  validateRoundRatingBounds,
  validateRecruiterIdentifiers,
  validateRecruiterRatingBounds,
  validateOverallReviewBounds,
];
export function validateDraft(draft) {
  return VALIDATION_RULES.flatMap((rule) => rule(draft));
}
```

Adding the "at least one round" rule became one more function on the
list, not a change to any rule that already existed or to
`validateDraft()` itself. The reminder side got the identical
treatment as its own parallel, equally small list — `REMINDER_RULES`
feeding `collectDraftReminders()` — deliberately a separate mechanism
from `DraftValidationIssue`, never touching Submit's disabled state.

## Key concept: a reminder that's genuinely dismissible, not blocking-with-extra-steps

The natural first design for "remind, don't force" is: show a warning,
require a second click to actually submit. That's what got built, but
the details matter. The review screen's Submit button is replaced
entirely by a confirmation panel once reminders exist — listing what's
apparently missing, with a "+ Add now" action per item that creates
the missing touchpoint with the correct timing and jumps straight into
editing it, alongside one "Submit anyway" button that submits for
real, immediately, in the same click (not a two-step "acknowledge,
then click Submit again" flow). Once acknowledged in a review visit,
the same reminder doesn't reappear — but since reminders are
recomputed live from the draft, adding the missing touchpoint clears
it from the list on its own, no separate dismissal bookkeeping needed
for that path.

## A real bug the new rule immediately surfaced (fixed in the next issue)

Attaching the "at least one round" issue to `stepId: 'process'` (so
its Fix link on the review screen goes somewhere sensible) turned out
to conflict with issue #306's Next-button work, built right after
this one: blocking Next from Process Details whenever this issue was
present would have trapped a candidate exactly where the fix (adding a
round) needs to happen. The eventual fix — giving every
`DraftValidationIssue` a stable `id`, so a caller like Next's own
gating logic can exclude specific rules by identity instead of
guessing from stepId or message text — is documented in issue #306's
own post, but the need for it traces directly back to this rule's
existence.

## What this enabled

A draft can never be submitted with zero rounds, full stop — and a
candidate who forgot a recruiter touchpoint gets asked about it
plainly, with a one-click way to either fix it or confirm it was
deliberate, instead of either silently accepting an incomplete
submission or refusing to accept a submission that might be
completely intentional.
