# Phase 34, Issues #358-359 — `/write-review` Route + Login-Gated `/drafts` Page

*Part of Phase 34 — Write-a-Review Flow Refinements. See
`docs/ROADMAP.md` Phase 34 and `docs/DECISIONS.md` D57.*

## The gap this closed

Phase 33 (D56) had already moved the write-a-review wizard from `/` to
`/search`, freeing `/` up to be the search/browse landing page. Issue
#357's homogeneous-row redesign then needed `/search` itself to go back
to being *purely* search/browse — it couldn't keep secretly hosting the
wizard too, or the two responsibilities would tangle again. Rather than
swap content back and forth a third time, the wizard needed a route of
its own, with a name that actually describes what it does.

## The custom answer that shaped this issue

Before filing, two clarifying questions went to the project owner. The
first (whether quick-select buttons should get the same row actions as
search results) had a simple answer. The second — about where the
wizard's drafts list should live once it moved out of the wizard itself
— got a genuinely custom answer, not a pick from the offered options:

> "drafts are based on user-session so keep it in such a way that
> they're not exposed without user login. probably keep it under
> /drafts path if you don't find the right fit. also write a review
> should not map to .../search — call it something instead."

Three concrete requirements came out of that one sentence: drafts need
a login gate even though they're not really session data; `/drafts` is
a reasonable route if nothing else fits better; and the wizard needs
its own distinct name, not `/search`.

## Key concept: `/write-review` replaces `/search` as a route, not a third swap

`web/src/app/search/page.tsx` moved wholesale to
`web/src/app/write-review/page.tsx`; the `search/` directory — and the
`/search` route itself — no longer exist. There's no third content
swap here, because `/` already does search/browse (since D56) — adding
a duplicate at `/search` would just be two routes for one job. The
wizard keeps every bit of its existing behavior (rounds, ratings,
recruiter steps, review screen, bulk submit, session-expiry warning,
add-round modal); only its "no company context" fallback narrows to a
single action: redirect straight to `/`.

## Key concept: a second query-param shape, `?draftId=`

The wizard already accepted `?companyId=&companySlug=&companyName=`
(start-or-resume by company, from a "Write a review" link). The new
`/drafts` page's Resume buttons need something more precise — resume
*this exact draft*, not "whichever draft matches this company" (a
candidate could in principle have more than one draft for the same
company). `/write-review` now checks for `?draftId=` first:

```ts
const draftId = searchParams.get('draftId');
if (draftId) {
  consumedContextRef.current = true;
  const existing = listDrafts().find((d) => d.id === draftId);
  if (existing) {
    setActiveDraft(existing);
    setActiveStepId('process');
  }
  router.replace('/write-review');
  return;
}
```

falling through to the existing companyId-based handoff if `draftId`
isn't present.

## Key concept: a redirect-loop bug, and why a ref (not state) fixes it

Once query params are consumed, the effect calls
`router.replace('/write-review')` to strip them from the URL — the
same pattern D56 already established. But the resulting *new*, empty
`URLSearchParams` object re-triggers the same effect (React's
dependency comparison is reference equality, and Next.js hands back a
fresh object on the next render). Naively, the effect would then see
"no draftId, no companyId" and redirect home — even though a draft is
already active and the whole point of stripping the URL was to make
staying on this page safe.

The fix is a `useRef` flag, set synchronously the instant context is
actually consumed, checked before the redirect-home branch:

```ts
const consumedContextRef = useRef(false);
// ...
if (!consumedContextRef.current) {
  router.replace('/');
}
```

A `useRef` was chosen deliberately over a second piece of state: a
`useState` update is only guaranteed visible on the *next* render, and
in principle a state update scheduled in the same effect that's about
to re-fire could interleave in a way a plain synchronous ref mutation
can't. The ref is set and read in the same tick, with no render cycle
in between to reason about.

## Key concept: `/drafts` gates on login, even though nothing there needs a session

Drafts are plain `localStorage` — no server-side session backs them at
all, and drafting itself has never required login (only the final
submit does, since Phase 26). `/drafts`'s gate is deliberately a
presentation-layer choice, not a technical necessity: the project
owner asked for it explicitly, and `GatedSection` (the same component
gating "My reviews" and the wizard's submit button) was the natural
fit, requiring no new gating mechanism.

```tsx
<GatedSection loggedIn={loggedIn} prompt="Log in to see your drafts.">
  {/* the actual drafts list */}
</GatedSection>
```

`NavBar` gained a matching "My drafts" link, shown only when logged in
— mirroring "My reviews" exactly — and lost its standalone "Write a
review" link entirely, since writing a review is always
company-specific now.

## A repeated testing lesson

D56 already documented that a naive `useSearchParams()` mock returning
`new URLSearchParams(...)` fresh on every call creates a new reference
every render, re-triggering effects keyed on `[searchParams]`. The same
fix — a stable, reassignable module-level reference
(`mockSearchParams.current`) — was needed again here, plus RTL's
`rerender()` (not `cleanup()` + a fresh `render()`) to simulate "params
get stripped, the same component instance persists" without
accidentally resetting `consumedContextRef` and defeating the test's
whole purpose.

## Step-by-step: what actually got built and verified

1. `web/src/app/search/page.tsx` moved to
   `web/src/app/write-review/page.tsx`; the `search/` route deleted.
2. `/write-review` narrowed its no-context state to a single redirect
   to `/`; the old inline drafts list and create-company form removed
   entirely (the create-company form resurfaces in issue #360's
   different context; the drafts list moves to step 3 below).
3. A `?draftId=` handoff added alongside the existing company-based
   one; a `consumedContextRef` guard added to prevent the redirect-loop
   bug described above.
4. New `web/src/app/drafts/page.tsx`: the drafts list, gated with
   `GatedSection`, with Resume (→ `/write-review?draftId=...`) and
   Delete actions per draft.
5. `NavBar` updated: "Write a review" link removed, "My drafts" link
   added (shown only when logged in).
6. `web/src/app/page.tsx` and `web/src/app/companies/[slug]/page.tsx`'s
   existing "Write a review" links updated to point at `/write-review`.
7. The renamed `write-review-page.spec.tsx` (7 tests: company handoff,
   draftId resume, no-context redirect, the redirect-loop fix
   specifically), a new `drafts-page.spec.tsx` (6 tests: login gate,
   empty state, listing, resume, delete, declined delete), 2 new
   `nav-bar.spec.tsx` tests, and 5 existing wizard-driving test files
   fixed for the new import path and router mock — 137 web tests
   total, build and lint clean.
8. Live-verified with a real headless browser (Playwright) against the
   real `kind` cluster: magic-link login, NavBar link checks, a company
   selection's "Write a review" link landing on `/write-review` with
   the URL stripped and the draft auto-started, "Back to my drafts"
   as a real link to `/drafts`, Resume via `?draftId=`, Delete, and
   both `/drafts` and NavBar correctly gating on logout — zero console
   errors. Test candidate cleaned up via the real `DELETE /me`
   GDPR-erasure endpoint.

## What this enabled

Writing a review now lives at a route whose name says what it does;
resuming a draft has a precise, unambiguous mechanism (`draftId`, not a
company-matching heuristic); and drafts have a home of their own that
respects the login-gating the project owner asked for, without
requiring any real backend session model changes to get there.
