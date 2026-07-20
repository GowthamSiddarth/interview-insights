# Phase 15, Issue #141 — Company Profile Page (`/companies/[slug]`)

*Part of Phase 15 — Public Company Profile Pages. Depends on issue
#140. See `docs/ROADMAP.md` Phase 15.*

## Why this came second

Issue #140 gave the API what was missing. This issue was meant to be
composition — a header, `ScoreDisplay` cards already proven in the
Phase 4 dashboard, a paginated list against the new reviews endpoint.
It turned into something more interesting: the first real routing
conflict this app has hit, caught only because dev mode was checked
and build mode wasn't trusted to be the last word.

## Key concept: `next build` and `next dev` don't validate the same things

The plan was `/companies/[slug]` alongside the existing
`/companies/[companyId]/analytics`. `npm run build` compiled both
routes without a single warning. Only starting `next dev` produced:

```
[Error: You cannot use different slug names for the same dynamic path ('companyId' !== 'slug').]
```

Next.js's App Router requires every dynamic segment at the same path
position to agree on a parameter name across the whole route tree —
`[companyId]` and `[slug]` both sitting directly under `/companies/`
violates that, even though one continues to `/analytics` and the other
terminates. The build step's static analysis apparently doesn't walk
the tree the same way the dev server's route resolution does. Had this
project trusted `build` + `lint` as sufficient (as CI does, and as it's
reasonable to expect), this would have shipped broken and only
surfaced the first time a real user hit either route in a browser —
exactly the class of gap this project's "manually verify in a real
browser" habit exists to catch, and did.

## Key concept: fixing the routing conflict made both routes better

The fix wasn't a workaround — it was moving the analytics dashboard to
`/companies/[slug]/analytics` too, resolving slug → id client-side
before calling the (unchanged) analytics endpoint. That's a genuine
improvement independent of the conflict: analytics URLs are now
human-readable and shareable, consistent with the profile page's own
addressing scheme, rather than a UUID a user would never type or
recognize.

## Key concept: `use(params)` needs infrastructure a bare test doesn't have

The pre-existing analytics page read its dynamic segment via
`params: Promise<{ companyId: string }>` and React's `use()` — a
pattern that had never been test-covered, because no test had ever
tried. Writing the new profile page's first component test surfaced
why: `use()` on a Promise suspends the component, and Next's App
Router wraps every route in a Suspense boundary automatically to catch
that; a bare `render()` from Testing Library does not, so the test
suspended forever and every assertion timed out against an empty
`<div />`. Rather than hand-wrapping every test in its own
`<Suspense>` (workable, but leaks an implementation detail from the
app into every test file that touches these pages), both pages switched to
`useParams()` from `next/navigation` — synchronous, no Promise, no
Suspense required, and the simpler choice on its own merits even
without the testing angle.

## System design approach

`web/src/app/companies/[slug]/page.tsx` composes three already-proven
pieces: the company header, `ScoreDisplay`-based aggregate cards (same
component the Phase 4 dashboard uses, same null-handling discipline —
hard constraint #3), and a paginated reviews list against issue #140's
endpoint. Loading and empty states are distinguished throughout
(Phase 9 issue #61's rule): a `null` company means still-loading, an
`EmptyState` means confirmed-zero, and they never look the same.

## Step-by-step: what actually got built and verified

1. **The route conflict discovery** — via `next dev`, not `next
   build`, the moment the new folder was added.
2. **The analytics move + slug resolution**, and the wizard's link
   updated from `company.id` to `company.slug`.
3. **The profile page itself** — header, aggregates, paginated review
   list.
4. **The `useParams()` migration** on both pages, prompted directly by
   trying (and failing) to write the first test.
5. **5 component tests**, once the Suspense problem was resolved.
6. **Real-browser verification (Playwright)** against dev servers
   backed by kind's Postgres/OpenSearch (D24/D26): seeded a company
   with 3 approved round ratings and 1 approved overall review.
   First pass showed "Not enough reviews yet" for *both* aggregate
   sections — correct for overall experience (n=1, below the
   shrinkage floor) but suspicious for round-type (n=3, which should
   score). The cause: Phase 4's materialized views have no refresh
   trigger yet (D15, a known, already-documented gap) — running
   `REFRESH MATERIALIZED VIEW` by hand made the round-type numbers
   appear immediately, while overall experience correctly kept showing
   "Not enough reviews yet" alongside its real `1 review` sample size.
   That's not a bug this issue introduced; it's the existing shrinkage
   floor and refresh-timing behavior, observed for the first time
   through a UI that could actually show the difference.

## What this enabled

A public destination that didn't exist before — real aggregate scores,
real reviews, addressed by a URL a person could actually share. It also
left the entry points (issue #142) as the only remaining piece: a page
nobody can navigate to doesn't get used no matter how correct it is.
