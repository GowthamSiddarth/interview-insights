# Phase 34, Issue #357 — Homogeneous Company-List Rows

*Part of Phase 34 — Write-a-Review Flow Refinements. See
`docs/ROADMAP.md` Phase 34.*

## The gap this closed

Phase 33 turned `/` into a two-part discovery page: a typed text search
and a quick-select grid of every existing company. Both lists showed
the *same information* — a company's name and size — but rendered it
two different ways. The typed-search-results list had a clickable
company-name button plus a "View profile" link. The quick-select grid
was a single flat button with the name and nothing else — no profile
link, no way to jump straight into writing a review. Two lists doing
the same job, one of them silently missing capabilities the other had.

## The fix: one shared row component

`web/src/components/CompanyResultRow.tsx` is now the only shape a
company is ever listed in, anywhere on the page: the name and size
bucket as plain text (not a button — see below), a "Browse reviews"
button, a "View profile" link, and a "Write a review" link. Both the
typed-search-results list and the quick-select grid render a `<ul>` of
these rows, passing the same `onBrowseReviews` handler
(`handleSelectCompany`) either way:

```tsx
<CompanyResultRow key={company.id} company={company} onBrowseReviews={handleSelectCompany} />
```

Because there's exactly one component, the two lists can't drift out
of sync again — a new action added to one shows up on both
automatically, since there's only one place to add it.

## Key concept: the company name stops being a click target

The old quick-select button and the old search-result name button both
made the *name itself* the thing you clicked to select a company. That
overloaded a piece of plain information (the name) with a hidden
action. The redesign makes selection an explicit, labeled button —
"Browse reviews" — leaving the name as inert text. This isn't just
cosmetic: a screen reader announcing a list of buttons named "Amazon",
"Walmart Tech", "Meta" gives no hint about what clicking does, where
"Browse reviews" does.

## Key concept: removing an asymmetric parenthesis

Once the row itself always said "View profile" as plain link text, the
same phrase elsewhere on the page needed to match exactly. Step 2's
header used to read `2. Browse reviews for {company} (view profile)` —
parenthesized, lowercase, visually de-emphasized as an aside. It's now
`2. Browse reviews for {company} View profile` — same link text, same
style, as the rows above it. A user scanning the page for "how do I see
this company's profile" now sees one consistent phrase instead of two
visually different ones meaning the same thing.

## A type-compatibility note from implementation

`CompanyResultRow`'s `company` prop is typed as the API client's
`CompanySearchResult` (`id`, `name`, `slug`, `industry`, `sizeBucket`),
not a narrower ad hoc shape. The quick-select grid's data comes from
`Company` (a superset, with a few extra fields like `logoUrl`) — TypeScript
accepts passing the wider `Company` objects where the narrower
`CompanySearchResult` is expected, since structural typing only checks
that all required fields are present. Reusing the client's existing
type instead of inventing a new one for the component avoided a
function-parameter-variance mismatch that a bespoke minimal interface
would have hit (a function expecting a *narrower* parameter type isn't
assignable where a function expecting the *wider* type is required).

## Step-by-step: what actually got built and verified

1. New `web/src/components/CompanyResultRow.tsx`, typed against
   `CompanySearchResult`.
2. `web/src/app/page.tsx`'s quick-select grid and search-results list
   both rewritten to render `<CompanyResultRow>` instead of their own
   bespoke markup; the quick-select block's `<div>` of buttons became a
   `<ul>` of rows, matching the search-results list's own structure.
3. Step 2's header link text changed from `(view profile)` to `View
   profile`, dropping the parentheses and the reduced-emphasis styling.
4. `page.spec.tsx` rewritten for the new row shape (the company name is
   no longer a button; "Browse reviews" is); a new
   `company-result-row.spec.tsx` unit-tests the shared component
   directly (name as plain text, correct href on both links, the
   `onBrowseReviews` callback firing with the right company) — 139 web
   tests total, build and lint clean.
5. Live-verified with a real headless browser (Playwright) against the
   real `kind` cluster: quick-select rows show all three actions with
   a non-clickable name; clicking "Browse reviews" reveals step 2;
   step 2's header shows plain "View profile" with no parentheses; and
   a typed search for an existing company shows the identical row
   shape as a second, independent match alongside the quick-select row
   — zero console errors.

## What this enabled

A visitor now sees exactly the same three actions no matter which list
found the company, and the copy describing "view this company's
profile" reads identically everywhere on the page — the "homogeneous"
requirement the issue asked for directly.
