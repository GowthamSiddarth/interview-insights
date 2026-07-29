# Phase 38, Issue #425 — Fix: "Previous" Left Stale Reviews on the Company Profile Page

*Part of Phase 38 — Company-Profile-Centric Review Browsing. See
`docs/ROADMAP.md` Phase 38.*

## The bug, as reported

Found live on the Gerhold - Schneider company profile while scoping
this phase's other two issues: paging forward through the Reviews
section (Next) worked fine, but clicking Previous to go back never
correctly restored page 1 — the list stayed on whatever the last
fetched page had shown.

## Root cause: a guard that outlived its original purpose

`web/src/app/companies/[slug]/page.tsx` fetched company + analytics +
the first page of reviews together on mount, then had a second effect
for page changes:

```tsx
useEffect(() => {
  // Skip the initial page (already fetched above alongside the company).
  if (!company || page === 1) return;
  setReviews(null);
  api.listCompanyReviews(company.id, page, PAGE_SIZE).then(setReviews)...
}, [company, page]);
```

The `page === 1` check was written for exactly one moment: skip the
redundant fetch on first mount, since page 1's reviews were already
fetched by the effect above. But the condition doesn't actually *know*
it's the first mount — it just checks the current value of `page`. So
it fires identically the *second* time `page` becomes 1: a Previous
click from page 2 back to page 1 sets `page` to `1`, the effect runs,
sees `page === 1`, and returns immediately without fetching anything.
`reviews` state is left holding page 2's data. The bug wasn't in the
pagination arithmetic (`Math.max(1, p - 1)` was always correct) — it
was that the fetch meant to *display* page 1 silently never ran a
second time.

## A first attempt that broke an existing test

The obvious-looking fix is to stop special-casing page 1 at all —
split the initial company+analytics+reviews fetch into two independent
effects (one for company/analytics, one for reviews keyed on
`[company, page]`) and let the reviews effect fire unconditionally
whenever `company` or `page` changes, including the very first time.
That does fix the Previous bug. It also broke an existing, previously
green test:

```
✕ shows the full round-type breakdown and all review groups when logged in
  expect(screen.getByText('Staff Engineer')).toBeInTheDocument()
  → Reviews section stuck showing "Loading…"
```

The original code fetched analytics and reviews together via
`Promise.all(...)`, so both always resolved in the same tick — a test
that `await`s the analytics text and then synchronously checks for
review content could rely on both being ready by then. Splitting them
into two independently-triggered effects decoupled that timing: the
reviews fetch now depends on a *second* async round trip (waiting for
the `company` state update to flow through a re-render before its own
effect even starts), so it can resolve later than the analytics
fetch it used to be bundled with. The fix was functionally correct and
still broke real, previously-passing coverage — a reminder that a
timing assumption baked into existing tests is still a real constraint
on a refactor, even when nothing in the test's *name* mentions timing.

## The actual fix: track "has the initial load happened," not "is page 1"

The right condition to skip on was never really about the *value* of
`page` — it was about whether *this slug's* initial bundled fetch had
already happened. A `useRef` (not state, so flipping it doesn't itself
trigger a render) tracks exactly that, and the original `Promise.all`
bundling is preserved:

```tsx
const initialReviewsLoadedRef = useRef(false);

useEffect(() => {
  initialReviewsLoadedRef.current = false;
  setPage(1);
  api.getCompanyBySlug(slug).then((c) => {
    setCompany(c);
    return Promise.all([api.getCompanyAnalytics(c.id), api.listCompanyReviews(c.id, 1, PAGE_SIZE)]);
  }).then(([a, r]) => {
    setAnalytics(a);
    setReviews(r);
    initialReviewsLoadedRef.current = true;
  })...
}, [slug]);

useEffect(() => {
  if (!company || !initialReviewsLoadedRef.current) return;
  setReviews(null);
  api.listCompanyReviews(company.id, page, PAGE_SIZE).then(setReviews)...
}, [company, page]);
```

The second effect still skips exactly once — while the bundled initial
fetch is in flight — but the skip condition no longer re-triggers just
because `page` happens to equal 1 again later. Once
`initialReviewsLoadedRef.current` flips to `true`, it stays `true` for
the rest of that slug's lifetime, so *every* subsequent page change,
including a Previous back to page 1, actually fetches.

## A second bug fixed for free: stale page across companies

Resetting `page` to 1 at the top of the slug-effect (and resetting the
ref alongside it) wasn't strictly required to fix the reported
Previous-button bug, but it closes the same class of gap one level up:
without it, navigating directly from company A's page 2 straight to
company B's profile would have started company B's Reviews section on
page 2 as well, since `page` state persists across a slug change in
the same mounted component.

## Step-by-step: what actually got built and verified

1. `initialReviewsLoadedRef` (`useRef(false)`) added; reset to `false`
   and `page` reset to `1` at the top of the slug-keyed effect, before
   the bundled `getCompanyBySlug` → `Promise.all([analytics, reviews])`
   fetch kicks off; ref flips to `true` only once that fetch resolves.
2. The page-keyed effect's guard changed from `if (!company || page
   === 1) return;` to `if (!company || !initialReviewsLoadedRef.current)
   return;` — everything else about the effect (fetch, `setReviews`
   reset, error handling) unchanged.
3. `web/tests/company-profile-page.spec.tsx` gained a "pagination"
   describe block: a regression test seeds distinguishable content per
   page (`page1Group`/`page2Group`), clicks Next then Previous, and
   asserts page 1's own content (not page 2's) is what's on screen
   afterward — 156 web tests total, lint and build clean.
4. Live-verified against the local dev server with a real headless
   browser (Playwright) and mocked API responses on a two-page review
   list: Next correctly shows page 2's content, and Previous correctly
   restores page 1's — the exact click sequence originally reported
   as broken — zero console errors.

## What this enabled

Paging backward through a company's reviews is trustworthy again — the
displayed page always matches the page number shown, in both
directions, for as long as you stay on that company's profile.
