# Phase 38, Issue #423 — Home Page & Search Results Navigate Straight to the Company Profile

*Part of Phase 38 — Company-Profile-Centric Review Browsing. See
`docs/ROADMAP.md` Phase 38.*

## The gap this closed

Phase 33's search-first landing page and Phase 34's homogeneous
`CompanyResultRow` (issue #357) both built toward the same page doing
double duty: `/` was where you found a company *and* where you browsed
its reviews, via an inline "2. Browse reviews for {company}" panel that
appeared underneath the search box once you picked a company — whether
by clicking a quick-select link or a search result row's dedicated
"Browse reviews" button. Meanwhile, Phase 15 had already built a real
company profile page (`/companies/{slug}`) with its own Reviews
section. Two different UI surfaces both showed a company's reviews,
and picking a company from the landing page took you to the wrong one
of the two.

Direct product feedback made the fix explicit: clicking a company
anywhere should go to its profile, full stop — not open a second,
parallel reviews view on the page you're already looking at.

## Key concept: delete the duplicate, don't redirect to the original

The tempting minimal fix is a redirect — keep the inline panel's code,
just navigate away instead of rendering it. That would have left dead
weight: a whole panel's worth of state (`selectedCompany`,
`reviewResults`, `reviewSearching`) and handlers (`handleSelectCompany`,
`handleReviewSearch`) that nothing calls anymore, still sitting in
`page.tsx` waiting to bit-rot. The actual fix removes the panel
entirely — its filtering capability doesn't move *with* the click
handler, it moves to a different page altogether (see issue #424's
post). `page.tsx` shrank from having two responsibilities (find a
company, browse its reviews) to one (find a company), and the
component got smaller, not just differently wired:

```tsx
// Before: onClick selected the company into local state, revealing a
// panel further down this same page.
<button onClick={() => handleSelectCompany(c)}>{c.name}</button>

// After: a real navigation, nothing left to render on this page.
<Link href={`/companies/${c.slug}`}>{c.name}</Link>
```

## Key concept: `CompanyResultRow` loses a prop, not just a button

`CompanyResultRow` (Phase 34, issue #357) had three actions: "Browse
reviews" (a callback prop, `onBrowseReviews`), "View profile" (a real
link), and "Write a review" (a real link). Dropping "Browse reviews"
here isn't cosmetic — the component's whole reason for taking an
`onBrowseReviews` callback prop was to let its parent (`page.tsx`)
plug in company-selection behavior. With nowhere left for that
behavior to go, the prop itself is gone, not just unused:

```tsx
interface CompanyResultRowProps {
  company: CompanySearchResult;
  // onBrowseReviews removed — there's nothing left for it to trigger.
}
```

The row is down to two real navigations, both plain `<Link>`s. Nothing
about this component holds application state anymore.

## What the redesign surfaced elsewhere on the page

With the inline panel gone, `/`'s own copy needed a pass too — the
"1. Find a company" heading implied a "2." that no longer exists
anywhere on the page, and the subtitle ("Find a company, then browse
and filter its approved reviews") described a capability the page
itself no longer offers. Both were simplified to describe what `/`
actually does now: find a company, then go somewhere else to do
anything with it.

## Step-by-step: what actually got built and verified

1. `web/src/components/CompanyResultRow.tsx`: `onBrowseReviews` prop
   and its "Browse reviews" `Button` removed; only "View profile" and
   "Write a review" `Link`s remain. The now-unused `Button` import
   dropped too.
2. `web/src/app/page.tsx`: the quick-select grid's buttons became
   `<Link href={/companies/{slug}}>` elements; the search-results
   list's `<CompanyResultRow>` call drops the `onBrowseReviews` prop;
   the entire "2. Browse reviews for {company}" `Card` section is
   deleted, along with `selectedCompany`, `reviewResults`,
   `reviewSearching`, `handleSelectCompany`, `handleReviewSearch`, and
   the now-unused `ReviewSearchResult`/`Round` type imports. Heading
   and subtitle copy updated to match a single-purpose page.
3. `web/tests/company-result-row.spec.tsx` rewritten around the
   two-link shape (no `onBrowseReviews` mock, an explicit assertion
   that no "Browse reviews" button renders).
4. `web/tests/page.spec.tsx`'s search-result-row test and quick-select
   describe block rewritten for real navigation (`href` assertions
   instead of a click-then-reveal-step-2 flow) — 156 web tests total,
   lint and build clean.
5. Live-verified against the local dev server with a real headless
   browser (Playwright) and mocked API responses: a quick-select link
   click lands on `/companies/{slug}`; a typed search's result row
   shows only "View profile" / "Write a review", no "Browse reviews"
   button anywhere — zero console errors.

## What this enabled

There's exactly one place on the whole site to browse a company's
reviews now — its profile page — and exactly one thing clicking a
company anywhere does: take you there. Issue #424 picks up from here,
merging the reviews-browsing capability the old panel offered into
that one remaining destination.
