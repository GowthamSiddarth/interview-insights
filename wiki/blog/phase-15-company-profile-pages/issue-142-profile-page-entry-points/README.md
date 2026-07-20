# Phase 15, Issue #142 — Entry Points: Link Search, Wizard, and Analytics to Profile Pages

*Part of Phase 15 — Public Company Profile Pages. Depends on issue
#141. See `docs/ROADMAP.md` Phase 15.*

## Why this came third — and why it was already partly done

A correct, well-tested page nobody can navigate to is dead weight.
This issue's job was making the profile page reachable from everywhere
a user would plausibly want it. One of the three planned link sites —
the wizard's company confirmation — was already done, not skipped
ahead of schedule but as an unavoidable side effect of issue #141:
fixing that issue's routing conflict required touching the wizard's
existing analytics link (`company.id` → `company.slug`), and adding
the adjacent profile link at the same time cost nothing extra. This
issue covered what remained: search results, and a link back from
analytics.

## Key concept: a search result serves two different intentions, so it needs two different affordances

The search page's company results already did something on click:
selecting a company for step 2's review-filtering form. Adding a
profile link raised an immediate design question — does clicking the
result now navigate away, or select it? Both are legitimate things a
user might want, and conflating them into one click means guessing
wrong loses whichever the user actually meant. The result keeps two
separate, clearly distinct elements in the same row: the existing
button (select for filtering, stays on `/search`) and a new "View
profile" link (navigates away). Neither shares a click target with the
other, so neither guesses.

## Key concept: closing a loop is not the same as opening one

Issue #141 added a forward link, profile → analytics. This issue added
the reverse, analytics → profile. It's tempting to treat that as
trivial — "just add a link" — but it's worth naming why it matters
distinctly: a one-directional link creates a page a user can enter but
not leave except via browser-back, which behaves inconsistently across
history states (especially after the slug-based analytics route
replaced the old UUID one — an old bookmarked or shared analytics URL
now has nowhere coherent to go without an explicit link). Closing the
loop makes both pages part of one coherent unit instead of one page
with an escape hatch bolted onto the other.

## System design approach

Three small, independent additions:

```
web/src/app/search/page.tsx
  - each company result row: existing select-button + new profile Link
  - the "Browse reviews for {company}" header: new (view profile) Link

web/src/app/companies/[slug]/analytics/page.tsx
  - new "Back to company profile" Link, using the slug already in scope
```

Nothing here touches the API — every link is a client-side `next/link`
computed from data the pages already had (`company.slug`, the route's
own `slug` param).

## Step-by-step: what actually got built and verified

1. **The search-result row change** — restructured from a single
   full-width button into a flex row holding both the button and the
   link, so styling didn't imply they were the same action.
2. **The review-filtering header link**, using `selectedCompany.slug`
   already held in that component's state.
3. **The analytics back-link**, using the `slug` `useParams()` already
   returns (issue #141 had just made this synchronous and available).
4. **3 new component tests**: two in `search-page.spec.tsx` covering
   both new links' hrefs, and a new `company-analytics-page.spec.tsx`
   — the analytics page had never had a dedicated test file at all
   until this issue gave it a reason to.
5. **Real-browser verification (Playwright)**, the full loop in one
   session: search for a company → click its "View profile" link →
   real profile page renders → "Full analytics breakdown" → analytics
   page → "Back to company profile" → back on the profile page. Zero
   console errors across every hop.

## What this enabled

Phase 15 is now fully done. A candidate can search for a company,
land on a real public profile with genuine shrinkage-scored aggregates
and reviews, drill into the full analytics breakdown, and get back —
all without a single dead end or unreachable page. Combined with
Phase 14's write paths, the platform now has a complete public-facing
loop: submit a review, have it moderated, and see it (and its effect
on the company's real numbers) reflected on a page anyone can visit.
