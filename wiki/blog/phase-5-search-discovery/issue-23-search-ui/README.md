# Phase 5, Issue #23 — Search UI

*Part of Phase 5 — Search & discovery. See `docs/ROADMAP.md` Phase 5.*

## Why this came first

Issues #21 and #22 built two real, independently useful search endpoints
— but neither had a UI. Issue #23 is a genuinely thin issue in terms of
new backend concepts (there are none — this is pure frontend, consuming
two already-finished, already-tested APIs), but it's a good case study in
how *little* new code a well-designed backend requires the frontend to
add, and in a debugging story worth understanding for its own sake: a
verification failure that looked like a frontend bug and turned out to be
a data-seeding gap instead.

## Key concepts

- **A two-step wizard, mirroring the two endpoints' dependency.** Step 1
  (find a company via issue #21) has to complete before step 2 (browse
  that company's reviews via issue #22) can run at all, since issue
  #22's endpoint requires a `companyId`. The UI's state model reflects
  this directly — `reviewResults` can't meaningfully exist until
  `selectedCompany` does.
- **An explicit empty state is a correctness requirement, not
  polish.** A zero-result search must render *differently* from "haven't
  searched yet" and from "still loading" — three genuinely distinct
  states that a naive implementation (e.g. an empty array rendered as an
  empty `<ul>`) would collapse into one indistinguishable blank area.
  This directly continues the pattern established by Phase 4's
  `ScoreDisplay` (issue #10): absence of data is its own first-class
  state, worth a dedicated, deliberate rendering path, not a value to
  paper over with a fallback.
- **The reusable `EmptyState` component is smaller and more general than
  `ScoreDisplay`, on purpose.** Where `ScoreDisplay` encodes a specific
  statistical rule (a `null` score means "under the shrinkage floor"),
  `EmptyState` encodes nothing product-specific at all — it's just "show
  this message, styled as an empty state" — because a zero-result search
  doesn't need any domain-specific interpretation the way a null
  shrinkage score does. Matching a component's specificity to how
  specific its underlying rule actually is (not over-generalizing a
  narrow rule, not over-specializing a genuinely generic one) is itself
  the transferable lesson.

## Core technologies

- **Two independent `useState<T[] | null>` result slots**
  (`companyResults`, `reviewResults`) — `null` meaning "haven't searched
  yet" and `[]` meaning "searched, zero results" are deliberately
  distinct values of the same type, which is what makes the `!== null`
  check in the render logic double as the "should I even show a
  results-or-empty-state block yet" gate.
- **The same `EmptyState` component reused for both steps**
  (`No companies match "..."` / `No reviews match these filters.`) —
  parameterized only by its message string.

## System design approach

```tsx
{companyResults !== null && (
  companyResults.length === 0
    ? <EmptyState message={`No companies match "${companyQuery}".`} />
    : <ul>{companyResults.map((company) => (/* selectable result */))}</ul>
)}
```

The `!== null` / `.length === 0` two-level check is the whole pattern:
`null` gates whether *any* results block renders at all (nothing shown
before the first search), and `.length === 0` inside that block decides
between the empty-state message and the actual result list. This exact
shape repeats for `reviewResults`, filtered by whatever combination of
`roleTitle`/`roundType`/`dateFrom`/`dateTo` the user has set — each
filter is passed straight through to issue #22's endpoint, which already
handles any subset of them being present or absent (see that post's
"every filter is conditionally added" design).

## The debugging story: a "frontend bug" that was actually a seed-script bug

This issue's manual browser verification (the same Playwright discipline
established in Phase 2.3) initially failed at the "select the company"
step — clicking a button matching the seeded company's name timed out.
The instinctive first read: a selector problem, or a timing/race issue in
the UI. Screenshotting the actual page at that step revealed the real
state: the company search had returned **zero results** for a company
that definitely existed in Postgres. The button was never rendered at
all — there was nothing wrong with the click, because there was nothing
to click.

Tracing *why* the seeded company wasn't searchable led to the actual
root cause, and it's a good general lesson about test/seed scripts
specifically: **the seed script created the company via a raw Prisma
call, bypassing `CompaniesService.create()` entirely** — and issue #21's
OpenSearch indexing only happens inside that service method, triggered by
the real API request path. A script that writes directly to Postgres
(a shortcut taken because approving three reviews one at a time through
the real moderation endpoint felt tedious) skipped every side effect the
real write path normally triggers, silently. The fix: the seed script now
explicitly also indexes the company into OpenSearch directly, mirroring
what the real API layer does, rather than assuming a raw Prisma insert
is equivalent to going through the service.

**The transferable lesson: any script or shortcut that writes directly to
a system's primary datastore, bypassing the actual service/application
layer, silently skips every side effect that layer is responsible for**
— indexing, moderation enqueueing, cache invalidation, webhook firing,
anything. This is a real, recurring risk with seed scripts, data
migrations, and admin tooling in any system with derived state (search
indexes, caches, read models) — the fix is either to route the shortcut
through the real service layer after all (slower, but correct by
construction) or to explicitly, consciously replicate every side effect
the shortcut is bypassing (faster, but requires knowing exactly what
you're skipping, and re-auditing that list whenever the real write path
gains a new side effect).

## Step-by-step: what actually got built

1. **Built `EmptyState`**, a minimal component taking just a `message`
   string.
2. **Built the `/search` page**: a company-search form (issue #21) whose
   results, once one is selected, reveal a second review-filter form
   (issue #22) scoped to that company.
3. **Added a "Search companies & reviews" link** from the homepage
   wizard, making the feature reachable through the app's existing
   navigation.
4. **Wrote 1 component test** (`search-page.spec.tsx`) covering the
   company empty-state path with a mocked `fetch`.
5. **Wrote a seed script** to set up realistic manual-verification data
   (one company, three approved reviews across two role titles and three
   round types) — directly via Prisma/OpenSearch, bypassing the real API
   specifically because driving three individual moderation approvals
   through the real endpoint felt like unnecessary overhead for a
   one-off manual verification pass.
6. **Ran the full 7-step Playwright verification**, hit the timeout
   described above, diagnosed it via a screenshot of the actual page
   state (not just the error message) rather than assuming the failure
   mode from the stack trace alone, traced it to the seed script's gap,
   fixed the seed script, and re-ran the full sequence clean: company
   empty state, company found, review selection, unfiltered results
   (3/3), a round-type filter narrowing to exactly 1 result, and a
   no-match filter empty state — zero console errors.

## What this enabled

Phase 5 closed out fully with this issue — company search, review search
with faceted filtering, and a UI tying both together, all independently
tested and manually verified. The seed-script lesson from this issue's
debugging story became a standing caution applied in every later phase's
manual-verification setup: whenever test/seed data is created via a
shortcut that bypasses the real write path, explicitly check what side
effects that shortcut might be skipping before trusting the verification
it's meant to support.
