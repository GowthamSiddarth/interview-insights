# Phase 49, Issue #690 — New `permanently_rejected` Terminal Status

*Part of Phase 49 — Resubmission Loop & Rejection Feedback.
See `docs/ROADMAP.md` Phase 49, D104.*

## The gap

#689 gates *who* can resolve an escalated entry, but not what happens
once they do: a plain `rejected` decision left the door open for yet
another edit and yet another trip through the queue — the resubmission
loop #689 escalated never actually closed.

## The fix

A new terminal `ModerationStatus` value, set instead of the normal
`rejected` specifically when an admin rejects an already-escalated
entry:

```ts
const entityStatus: ModerationStatus =
  decision === 'rejected' && entry.escalated ? 'permanently_rejected' : decision;
```

Computed once, before the transaction, so both the entity-status write
inside it and the `status_changed` domain event published after it
agree on the same value — a normal (non-escalated) rejection is
completely unaffected; only an *escalated* rejection gets the terminal
treatment.

Each write-path service's `update()` then blocks any further edit on a
terminally-rejected row:

```ts
if (rating.status === 'permanently_rejected') {
  throw new ForbiddenException(
    'This rating has been permanently rejected and can no longer be edited.',
  );
}
```

Applied identically across `RoundRatingsService`, `RecruiterRatingsService`,
and `OverallReviewsService` — the same check, three times, since each
service owns its own `update()` method with no shared base class to hook
into once.

## Verification

A new e2e case in `moderation.e2e-spec.ts` drives the full loop: three
reject-then-edit cycles to trip escalation (#689), an admin rejection of
the escalated entry, then asserts the follow-up edit attempt gets a 403
— proving the loop is actually closed end to end, not just that the
status value changes in isolation. A sibling test confirms an *approved*
decision on an escalated entry still sets plain `approved`, never
`permanently_rejected` — the terminal status is specific to the
reject-an-escalated-entry path, not a blanket "escalated implies
terminal" rule.
