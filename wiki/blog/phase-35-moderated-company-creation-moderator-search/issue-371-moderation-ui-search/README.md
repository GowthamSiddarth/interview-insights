# Phase 35, Issue #371 — Moderation UI Search Box + Category Filter

*Part of Phase 35 — Moderated Company Creation & Moderator Search. See
`docs/ROADMAP.md` Phase 35.*

## The gap this closed

Issue #370 built a real search endpoint; nothing on `/moderation`
called it yet. This issue surfaces it: a search input and a category
select that replace the existing grouped-by-submission view with a
flat list of matches.

## Key concept: category alone (no query) still searches

The most easily-missed requirement here: the issue's acceptance
criteria explicitly say "the category filter, combined with a query or
alone, correctly narrows results" — a moderator should be able to
browse just the create-company requests without typing anything.
"Search mode" is therefore triggered by either signal, not just a
non-empty query:

```ts
const isSearching = query.trim() !== '' || categoryFilter !== '';
```

An empty query with "Any" category is the only combination that falls
back to the normal grouped view.

## Key concept: the category badge is derived, never sent over the wire

`GET /moderation/search`'s response entries are the same shape
`listPending()` already returns — there's no `category` field on the
wire at all. The frontend derives it purely from `entityType`, the
identical rule the backend itself uses to build the index in the first
place:

```ts
function categoryFor(entityType: ModerationQueueEntry['entityType']): ModerationQueueCategory {
  return entityType === 'company' ? 'create-company' : 'interview-review';
}
```

Keeping this derivation client-side (rather than adding a redundant
field to the API response) means the two can never drift out of sync —
there's only one place, the `entityType` value itself, that decides
which bucket an entry belongs to.

## Key concept: one `EntryActions` component, two very different views

The grouped view's Approve/Reject/Flag controls (plus the flag-reason
select) already existed, inline, before this issue. Rather than
duplicate that JSX for the new flat search-results view, it was
extracted into a shared `EntryActions` component:

```tsx
<EntryActions
  entry={entry}
  flagReason={flagReasonById[entry.id] ?? 'manual_report'}
  onFlagReasonChange={(reason) => setFlagReasonById((prev) => ({ ...prev, [entry.id]: reason }))}
  onAct={(action) => void act(entry, action)}
/>
```

Both the grouped `Card` rows and the flat search-result `Card`s render
the identical component — approve/reject/flag behave the same no
matter which view a moderator happens to be looking at, by
construction rather than by careful duplication.

## Key concept: acting on a search result updates both view states at once

`act()` already updated `groups` optimistically after a successful
moderation action. Since only one of `groups`/`searchResults` is ever
actually rendered at a time, the simplest fix was to update both
unconditionally:

```ts
setGroups((prev) => prev?.map(/* ... */).filter(/* ... */) ?? null);
setSearchResults((prev) => prev?.filter((e) => e.id !== entry.id) ?? null);
```

Whichever state is `null` (not the active view) just no-ops via
optional chaining — no need to branch on which mode the page is
currently in.

## A testing note: fake timers for a debounced input

The search input debounces for 300ms before actually calling the
endpoint — testing that deterministically needed the same fake-timer
pattern `session-expiry-warning.spec.tsx` already established
(`jest.useFakeTimers({ advanceTimers: true })` plus
`userEvent.setup({ advanceTimers: jest.advanceTimersByTime })`), rather
than a real `setTimeout` wait that would make the test suite slower and
theoretically flaky under load.

## Step-by-step: what actually got built and verified

1. `api.ts` gained `searchModerationQueue()` and a
   `ModerationQueueCategory` type.
2. `web/src/app/moderation/page.tsx` gained the search input + category
   select, a debounced effect calling the new endpoint, and the flat
   search-results rendering branch (with loading/empty states
   distinguished, matching the existing grouped view's own rule).
3. The existing action controls extracted into a shared `EntryActions`
   component.
4. 5 new tests in `moderation-page.spec.tsx` (query narrows to badged
   results, clearing restores the grouped view, category-alone
   filtering, a distinct empty state, acting on a search result) — 149
   web tests total, build/lint clean.
5. Live-verified against the real `kind` cluster with a real headless
   browser (Playwright): created a pending company request, searched
   for it and saw its category badge, confirmed category-alone
   filtering both included and excluded it correctly, approved it
   directly from the search result, and confirmed clearing filters
   restored the grouped view — zero console errors.

## What this enabled

The moderation queue's search endpoint (issue #370) is no longer
backend-only infrastructure — a moderator can actually find a specific
entry among a growing queue, filtered by category, without scrolling
through everything.
