# Phase 9, Issue #61 — Investigate Ambiguous Loading vs. Empty States

*Part of Phase 9 — UX/UI Polish Pass. See `docs/ROADMAP.md` Phase 9,
`docs/DECISIONS.md` D21.*

Deeper dive than the phase's other posts — this issue started as "maybe
nothing's wrong here" and ended with a genuinely transferable React 19
finding, confirmed live rather than assumed from a changelog.

## Why this came first

Every other issue in this phase started from a confirmed, visible
problem (a stray comment, a missing nav link, a monochrome button). This
one started from a *pattern* noticed while auditing the code, not yet a
confirmed bug: several pages use `useState<T | null>(null)`, where `null`
is meant to distinguish "haven't fetched yet" from "fetched, got an empty
result." That pattern is only actually correct if every render path
checks for `null` explicitly — and the acceptance criteria for this
issue was explicit that an unconfirmed suspicion isn't grounds to change
anything: investigate first, with real evidence, and only then decide
whether there's something to fix.

## Core concept: three states often get collapsed into two, and the collapse is easy to miss

Any asynchronously-loaded UI has (at least) three real states: **haven't
requested yet**, **request in flight**, and **request resolved** (which
itself splits into "resolved with data" and "resolved, empty"). A
`useState<T | null>(null)` pattern is set up to distinguish exactly two
of these — `null` versus non-null — which is fine *only if* nothing ever
needs to distinguish "in flight" from whichever of the other two states
`null` (or a stale previous value) happens to represent at that moment.
The moment a fetch can take long enough for a user to notice, "in
flight" needs to be its own visible state, or two genuinely different
situations render identically.

## Investigation: confirming a suspicion with evidence, not more reading

Rather than deciding by re-reading the code whether this was a real
problem, the investigation used Playwright's request interception to
inject a deliberate 2-second delay on every API call, then checked what
each page actually showed during that window — the same technique used
throughout this project for "verify, don't assume."

**Confirmed case 1 — homepage.** `approvedRatings` is `useState<
RoundRating[] | null>(null)`, rendered as `approvedRatings?.length ?? 0`.
While the fetch was artificially delayed, the page displayed: "Public
approved ratings for this round: **0**" — identical, character for
character, to what a genuinely zero-approved-ratings result would show.
A user has no way to tell "still checking" from "confirmed nothing yet."

**Confirmed case 2 — search page, first search.** Clicking "Search"
produced no visible change at all for the full 2-second delay — no
spinner, no text, nothing. This is identical to the state *before*
clicking Search at all. A user has no feedback their click registered.

**Confirmed case 3 — search page, repeat search.** After an initial
search returned results, running a *second* search (a different query)
kept the *first* search's results on screen, unchanged, for the entire
delay — stale data presented with no indication it no longer matches the
current query.

**Confirmed non-issue — analytics dashboard.** This page already had an
explicit `if (!analytics) return <PageContainer><p>Loading…</p></...>`
branch, correctly distinct from every other state. Reading the code was
enough here; no live check changed the conclusion. Worth stating
directly: the investigation didn't assume every page had a bug just
because two did — it checked each one on its own evidence.

## The fix, and the deeper thing it surfaced

The homepage fix is a one-line, unambiguous change:

```tsx
// Before: null (still fetching) and 0 (confirmed zero) render identically.
<strong>{approvedRatings?.length ?? 0}</strong>

// After: null gets its own, distinct rendering.
<strong>{approvedRatings === null ? '…' : approvedRatings.length}</strong>
```

The search page fix looked like it should be equally simple — add a
`companySearching` boolean, set it before the `await`, use it to show a
"Searching…" message with priority over stale results. Implementing
exactly that and testing it revealed a second, unrelated, and much more
general bug: **the loading indicator never appeared, in either a unit
test or a real browser.**

## Core concept: React 19 form actions don't flush every state update the moment you'd expect

This app's forms use React 19's `<form action={fn}>` pattern — passing
a plain async function directly as a form's `action`, which React treats
as implicitly running inside a transition. The search page's handler
looked like this:

```tsx
async function handleCompanySearch(formData: FormData) {
  setError(null);
  const q = String(formData.get('q'));
  setCompanyQuery(q);
  setCompanySearching(true);       // <- called synchronously, before any await
  try {
    setCompanyResults(await api.searchCompanies(q));
  } finally {
    setCompanySearching(false);
  }
}
```

Confirmed directly (not assumed from React's documentation or a
changelog): a `setState` call made **before the first `await`** inside a
function passed to `<form action={fn}>` does not commit to the DOM until
some `await` inside that same function resolves. The UI stays exactly as
it was before the click — not stale data, not an error, just silence —
for the entire duration of the first async operation, no matter what
state you set beforehand.

This raised an immediate, important question: if this is true, how did
the **homepage's** loading indicator (`approvedRatings === null`) render
correctly, given it's also inside an `action={fn}` handler? The answer
is the key detail: `handleCreateRating` sets `setRating(created)` — the
state that gates rendering the "approved ratings" block at all — *after*
its own first `await` (`await api.createRoundRating(...)`) already
resolved, not before it:

```tsx
async function handleCreateRating(formData: FormData) {
  // ...
  const created = await api.createRoundRating(round.id, { /* ... */ }); // first await
  setRating(created);                                                   // AFTER it resolves — this DOES render
  const approved = await api.listApprovedRatingsForRound(round.id);      // second await
  setApprovedRatings(approved);                                         // also after an await — renders fine
}
```

**The general, transferable rule (recorded as D21): a `setState` call's
timing relative to the *first* `await` in a form-action handler
determines whether it renders promptly.** Anything before that first
`await` is batched into the action's initial transition and deferred
until some `await` resolves; anything after an `await` has already
resolved runs as a normal continuation and commits immediately, the same
as any other state update. This is a real, non-obvious characteristic of
how React 19 treats `<form action={fn}>` — not a bug in this
application's code, but a sharp edge in the framework primitive that
this project's specific use case (an in-flight indicator, set *before*
any async work starts) happened to land directly on.

## The fix: plain `onSubmit`, not `action`

Rather than working around the transition-batching behavior (e.g.
forcing a synchronous flush, or artificially inserting an `await` before
the state update — both fragile, implementation-detail-dependent
approaches), the two search handlers were converted to ordinary
`onSubmit` handlers:

```tsx
async function handleCompanySearch(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  setError(null);
  const q = String(formData.get('q'));
  setCompanyQuery(q);
  setCompanySearching(true); // now a normal event-handler setState — commits immediately
  try {
    setCompanyResults(await api.searchCompanies(q));
  } finally {
    setCompanySearching(false);
  }
}
```

```tsx
<form onSubmit={handleCompanySearch} className="flex gap-2">
```

A plain DOM event handler's `setState` calls flush the same way any
other click handler's do — no dependency on React's action/transition
batching semantics at all. This is a strictly more predictable mechanism
for this specific need (show a state change the instant an interaction
happens, before any async work), and it's now the standing rule (D21)
for any future form in this app that needs an in-flight indicator:
`action={fn}` stays fine — and is left unchanged elsewhere in this app —
for forms whose loading-relevant updates only happen after an `await`
already resolved, or that don't need an in-flight state at all.

## Step-by-step: what actually got built

1. **Investigated first, using request interception** to simulate a slow
   network and observe each page's actual behavior — the homepage rating
   count, the search page's first and repeat searches, and the analytics
   dashboard — before deciding anything was broken.
2. **Confirmed two real bugs and one non-issue**, each with a screenshot
   and a captured DOM state as evidence, not a guess.
3. **Fixed the homepage** with the `null`-vs-`0` distinction — one line.
4. **Fixed the search page's rendering logic** — a `companySearching`/
   `reviewSearching` boolean per search, shown with priority over stale
   results — and confirmed it *didn't* work as written, in both a unit
   test and a live browser check.
5. **Diagnosed why**, by tracing exactly which `setState` calls in the
   codebase *did* render promptly (the homepage's `setRating`) versus
   which didn't (the search page's `setCompanySearching`), and identified
   the first-await boundary as the actual variable.
6. **Converted both search forms from `action={fn}` to `onSubmit={fn}`**,
   re-verified the fix in both the unit test and a real browser against
   the same deliberately-delayed response, and confirmed both the
   first-search and repeat-search cases now show "Searching…" correctly
   with zero console errors.
7. **Recorded the finding as D21** in `docs/DECISIONS.md`, specifically
   because it's a framework-level characteristic other forms in this
   codebase (and any other React 19 app) could hit again, not a
   one-off mistake in this file.

## What this enabled

The homepage's existing `action={fn}` forms didn't need to change at
all — this issue's investigation is what established *why* they were
already safe (their relevant state updates happen after an await), not
just that they happened to work. Any future form added to this app that
needs to show state before its own first `await` now has a documented,
tested answer: use `onSubmit`, not `action`. This is also a broadly
reusable debugging lesson on its own: when a fix that looks obviously
correct doesn't work, the next step is finding a case where the *same
shape* of code demonstrably does work, and tracing the actual difference
between them — not assuming the framework, not re-guessing the fix.
