# Phase 33 — Search-First Landing Page

*See `docs/ROADMAP.md` Phase 33 and `docs/DECISIONS.md` D56.*

## The pivot

Every phase before this one treated the landing page as the wizard —
the first thing any visitor saw was a form to write a review. That
made sense when the product's core loop (candidate submits, moderator
approves, aggregate score appears) was still being built out. But most
visitors to a site like this aren't mid-interview-loop candidates ready
to write something; they're people trying to decide whether to
interview somewhere, or curious what a company's loop looks like.
Searching and browsing is the more common verb, by a wide margin, and
the landing page should reflect that. The fix: swap what `/` and
`/search` each show.

## Key concept: a swap, not a rewrite

Both pages already existed and worked — the search/browse flow (Phase
5's two-step company-then-reviews experience) and the write-a-review
wizard (Phase 26's client-side draft flow) needed no new functionality,
just a new home. `web/src/app/page.tsx` and `web/src/app/search/
page.tsx` swapped their entire body content; the routes themselves
didn't move, only which component each one renders. This kept the
change mechanical and low-risk — nothing about *how* searching or
drafting works changed, only *where* a visitor lands by default.

## Key concept: the wizard shouldn't need its own company picker anymore

The wizard used to open with a grid of company buttons — pick one,
start drafting. Once discovery became the landing page's job, keeping
a second, parallel company picker inside the wizard would have meant
two different places doing the same thing, with no clear reason to
prefer one over the other. The fix: remove the wizard's picker
entirely. Company selection for a new draft now always happens
upstream — a new "Write a review" link, added to a selected search
result and to a company's public profile page, carries the chosen
company into the wizard via query params:

```
/search?companyId=...&companySlug=...&companyName=...
```

The wizard reads these once on mount, resumes an existing draft for
that company if one's already in progress (matched by `companyId`
against `listDrafts()`) or starts a fresh one, then strips the params
from the URL (`router.replace('/search')`) so a later reload lands on
the plain drafts list instead of silently repeating the auto-start.
Arriving at `/search` with no company context at all (e.g. via
NavBar's "Write a review" link) still works — it just shows the
drafts list and the "create a genuinely new company" form, nothing
else.

## Key concept: `useSearchParams()` needs a Suspense boundary

Next.js's App Router treats a component that calls `useSearchParams()`
as unable to render statically unless it's wrapped in `<Suspense>` —
without one, `next build` fails outright, not just warns. This
project had already hit this once, in `auth/verify/page.tsx` (the
magic-link landing route, which reads a `token` query param the same
way). The wizard's default export follows the identical shape: a thin
wrapper renders `<Suspense fallback={null}>` around the real content
component that actually calls the hook.

## A real test-authoring bug, not a flake

The first pass at updating the wizard-driving test files mocked
`next/navigation` like this:

```ts
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () =>
    new URLSearchParams('companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp'),
}));
```

This looked reasonable and even passed for a couple of files — until
one test file's run simply hung past its timeout. The bug: `new
URLSearchParams(...)` inside the arrow function creates a **new
object** every single time `useSearchParams()` is called — and it gets
called on every render, not just the first. React's `useEffect`
dependency comparison uses reference equality, so a `useEffect(() =>
{...}, [searchParams])` sees a "changed" dependency on every render and
re-runs — including the company-handoff effect that resumes or starts
a draft. Since `listDrafts()` also returns freshly-parsed objects on
every call, `setActiveDraft(existing)` kept firing with a new object
reference each time, forcibly resetting the active step back to
`'process'` on every re-render — an infinite loop of state resets that
manifested as a genuine hang, not a flaky timeout.

The fix was to make the mock match what real Next.js actually does:
memoize `useSearchParams()`'s return value across re-renders when the
URL hasn't changed, by constructing the `URLSearchParams` instance once
at the mock's module-initialization time and returning that same
reference on every call:

```ts
jest.mock('next/navigation', () => {
  const params = new URLSearchParams(
    'companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
  );
  return {
    useRouter: () => ({ replace: jest.fn() }),
    useSearchParams: () => params,
  };
});
```

One test (simulating a reload after a draft already auto-started) also
needed to swap this reference to an *empty* `URLSearchParams` partway
through, mirroring what a real reload would see once `router.replace`
had already stripped the params from the browser's URL bar.

## Step-by-step: what actually got built and verified

1. `web/src/app/page.tsx` and `web/src/app/search/page.tsx` swapped
   content; the new landing page gained a quick-select company-button
   grid (`api.listCompanies()`, one button per company) alongside its
   existing text search.
2. The wizard's own company-picker button grid removed entirely; a new
   query-param-driven effect resumes-or-starts a draft on mount.
3. A "Write a review" link added to the search page's step-2 header
   (once a company is selected) and to the company profile page's
   header, both carrying the company via query params.
4. `NavBar`'s link relabeled "Write a review".
5. Two page-level test files (`page.spec.tsx`, `search-page.spec.tsx`)
   swapped content to match; all five wizard-driving test files
   updated for the new query-param entry point instead of a
   picker-button click; `nav-bar.spec.tsx` updated for the new link
   text — 131 web tests total, build and lint clean.
6. Live-verified with a real headless browser (Playwright) against the
   real `kind` cluster: the landing page shows search plus quick
   company buttons; NavBar shows "Write a review"; selecting a company
   (either way) reveals a correctly-parameterized "Write a review"
   link; clicking it lands on `/search` with the draft auto-started
   and the URL params stripped; the wizard shows no company-picker
   anywhere; the company profile page has its own working link — zero
   console errors throughout.

## What this enabled

The platform's default experience now matches what most visitors
actually want to do first — and writing a review became a deliberate,
one-click action from wherever a candidate already found their
company, rather than the only thing the front door offered.
