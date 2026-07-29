# Phase 38, Issue #424 — Review Filtering Merged Into the Reviews Section

*Part of Phase 38 — Company-Profile-Centric Review Browsing. See
`docs/ROADMAP.md` Phase 38.*

## The gap this closed

Issue #423 deleted the landing page's inline "browse reviews" panel —
role title, round type, and date-range filters over `GET
/search/reviews`, scoped to whichever company you'd picked. That
filtering capability still needed a home, and the obvious first draft
was a new "Browse reviews" section on the company profile page,
alongside "Overall experience," "By round type," and "Reviews." Direct
feedback rejected that draft before it was built: the profile page
already has a Reviews section listing every approved review, grouped
by submission and paginated. A second section that also lists reviews,
just filtered, is the same duplication problem issue #423 had just
fixed, one level down — two places on one page showing overlapping
review data. The fix folds filtering into the *existing* Reviews
section instead of adding a sibling to it.

## Key concept: reuse the gate boundary, not just the gate mechanism

The Reviews section already soft-gates its non-preview content behind
login, via the same `GatedSection` component Phase 21's anonymous
visitor soft-gating (D40, issue #226) introduced: the first review
group is always visible (the free hook), everything past it — the
rest of the list, the pagination controls — sits behind a "Log in to
see the other N reviews" prompt. The filter form goes *inside* that
same `GatedSection`, not behind a second, separately-conditioned gate:

```tsx
<GatedSection
  loggedIn={candidateSession}
  prompt={`Log in to see the other ${reviews.total - 1} review${...}`}
>
  <form onSubmit={handleFilterSearch}>{/* role title, round type, from, to */}</form>
  {/* filtered results OR the default grouped/paginated list below */}
</GatedSection>
```

This isn't just implementation convenience. It's a deliberate product
consistency call: filtering through a company's reviews is exactly the
kind of "more than the free preview" capability this page already
reserves for logged-in visitors everywhere else — the full round-type
breakdown, the rest of the reviews, pagination. Filtering doesn't get
its own, differently-justified gate; it's one more thing on the list
behind the existing one.

## Key concept: one section, two data shapes, toggled by state

The tricky part isn't the gating — it's that the Reviews section's
default content (`CompanyReviewsPage` → `CompanyReviewGroup[]`, grouped
by submission, paginated via `listCompanyReviews`) and a filtered
search's results (`ReviewSearchResult[]`, flat, one row per rated
round, from `searchReviews`) are genuinely different shapes with
different rendering. Rather than reconciling them into one shape, the
section just shows one or the other, keyed off whether a filter is
currently active:

```tsx
const [filterResults, setFilterResults] = useState<ReviewSearchResult[] | null>(null);

// null  → show the default grouped/paginated list (reviews.items.slice(1) + Previous/Next)
// non-null → show filterResults instead (flat, no pagination), with a "Clear filters" button
```

No backend work was needed for this at all — `GET /search/reviews`
already accepted `companyId` as a filter (it's what the deleted home-page
panel called), so the profile page just calls the same endpoint with
its own `company.id` pre-filled in, instead of a home-page-selected
company's id.

## What this enabled

The company profile page now has exactly one place to see reviews,
whether you want all of them (paginated) or a filtered subset (role
title, round type, date range) — both behind the same login gate,
both in the same section, with a "Clear filters" control to switch
back. Nothing about "Overall experience" or "By round type" changed;
the redesign is scoped entirely to Reviews.

## Step-by-step: what actually got built and verified

1. `web/src/app/companies/[slug]/page.tsx`: new `filterResults` /
   `filterSearching` state; `handleFilterSearch` (submits the form,
   calls `api.searchReviews({ companyId: company.id, roleTitle,
   roundType, dateFrom, dateTo })`) and `handleClearFilters` (resets
   `filterResults` to `null`).
2. The Reviews section's `GatedSection` gains a filter `<form>` (Role
   title, Round type, From, To, Search reviews — reusing the same
   round-type `<option>` list the deleted home-page panel had) above
   its content, and a "Clear filters" button once a filter is active.
3. Content below the form branches on `filterResults`: `null` renders
   the existing grouped list + Previous/Next controls unchanged;
   non-null renders a flat `<ul>` of filtered results (role — round
   type, free text, Difficulty/Fluency/Clarity/Focus), matching the
   deleted panel's item styling exactly.
4. `web/tests/company-profile-page.spec.tsx` gained a
   "Reviews section: merged filtering" describe block: the filter form
   is absent when logged out; submitting a filter while logged in
   calls `GET /search/reviews` with the right `companyId`/filters,
   replaces the default list with the flat results, and "Clear
   filters" restores the default list — 156 web tests total, lint and
   build clean.
5. Live-verified against the local dev server with a real headless
   browser (Playwright) and mocked API responses: the filter form
   renders inside the Reviews section when logged in, submitting a
   role-title filter shows the flat filtered result in place of the
   default list, and "Clear filters" brings the paginated list back —
   zero console errors.
