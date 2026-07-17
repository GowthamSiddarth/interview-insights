# Phase 9, Issue #59 — Wizard: Change Company Without a Page Reload

*Part of Phase 9 — UX/UI Polish Pass. See `docs/ROADMAP.md` Phase 9.*

## Why this came first

The Phase 2 wizard's state model was built to prove one thing: the full
`Company → InterviewProcess → Round → RoundRating` chain works end to
end. It was never built to be *changed course* mid-flow — once
`setCompany(created)` ran, nothing in the component ever set it back to
`null` again. A user who picked the wrong company, or wanted to add a
second review for a different one, had exactly one option: reload the
page and start over, discarding whatever progress they'd made.

## Key concepts

- **A wizard's state model is a dependency graph, and "reset" means
  walking that graph, not clearing one field.** `company` isn't an
  isolated piece of state — `candidateId`, `process`, `round`, `rating`,
  and `approvedRatings` all exist *because* a company was selected, and
  all of them describe things that were true only for that company. A
  naive fix (`setCompany(null)` alone) would have left the wizard showing
  a stale process/round/rating from the previous company, now
  disconnected from any real selection — a worse bug than the one being
  fixed, since it would look like valid, current data.
- **"Reset everything downstream" is a specific, enumerable list — write
  it out, don't guess.** Six pieces of `useState` exist in this
  component; five of them depend transitively on `company`. Resetting
  requires resetting exactly those five, explicitly, in one place — not
  relying on each individual step's own logic to notice its inputs
  changed (React doesn't automatically invalidate derived state that
  way; every dependent field needed its own explicit `setX(null)` call).

## System design approach

```tsx
function handleChangeCompany() {
  // Reset every step that depended on the previous company — none of
  // it applies once a different company is selected.
  setCompany(null);
  setCandidateId(null);
  setProcess(null);
  setRound(null);
  setRating(null);
  setApprovedRatings(null);
  setError(null);
}
```

This function is deliberately the *only* place all six resets happen
together, called from a single "Change company" action next to the
"Using X" confirmation text. The alternative — resetting downstream
state piecemeal, e.g. only when a later step's own handler runs — would
mean the "stale process" bug reappears any time a new interaction path
is added later that doesn't happen to go through the right handler.
Centralizing the reset in one function tied directly to the one user
action that causes it ("I'm changing companies") keeps the invariant
enforced at its actual source, not scattered across every consumer of
the state.

```tsx
{company && (
  <p className="text-sm text-green-700 dark:text-green-400">
    Using {company.name}.{' '}
    <Link href={`/companies/${company.id}/analytics`}>View analytics dashboard</Link>{' '}
    · <button type="button" onClick={handleChangeCompany}>Change company</button>
  </p>
)}
```

Placing "Change company" directly next to "Using X" — rather than, say,
a separate button elsewhere on the page — keeps the action co-located
with the exact piece of state it affects, which is the same locality
principle that made the reset function itself easy to write correctly:
the thing you're changing and the control that changes it are right next
to each other.

## Step-by-step: what actually got built

1. **Enumerated every piece of state that depends on `company`** by
   reading the component's existing `useState` declarations and their
   usages, rather than assuming which ones mattered.
2. **Wrote `handleChangeCompany`** resetting all six in one function.
3. **Added the "Change company" action** next to the existing "Using X"
   text, styled as a text link consistent with "View analytics
   dashboard" beside it.
4. **Wrote a component test** simulating: select a company (from a
   mocked list), confirm "Using X" appears, click "Change company",
   confirm the wizard returns to the company-selection state and "Using
   X" is gone.
5. **Verified in a real browser**: created a first company, proceeded
   through the candidate/process step, used "Change company" mid-flow,
   confirmed the wizard reset cleanly (no leftover "process created"
   message, no stale round/rating data), then drove a *second* company
   through the entire flow — process, round, rating — end to end, proving
   the reset didn't just clear the UI but left the component in a
   genuinely fresh, fully-functional state for the new selection.

## What this enabled

This issue is a small, self-contained example of a pattern worth
recognizing in any state-heavy form/wizard component: whenever a
"go back" or "start over" action is added to something with dependent
state, the actual work is identifying the dependency graph correctly,
not writing the reset call itself (which is trivial once the graph is
known). Getting the graph wrong — resetting too little — produces a
subtler, more dangerous bug than not having the reset feature at all,
because stale-but-plausible-looking data is harder to notice than an
obviously broken page.
