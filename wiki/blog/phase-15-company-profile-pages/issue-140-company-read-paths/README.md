# Phase 15, Issue #140 — Company Read Paths: Slug Lookup + Approved Reviews List

*Part of Phase 15 — Public Company Profile Pages. See
`docs/ROADMAP.md` Phase 15.*

## Why this came first

The profile page needed two things the API had never provided: a way
to look a company up by something a human would type into a URL bar,
and a way to list a company's individual approved reviews rather than
just their aggregates. Building the reads before the page meant the
page could be written against a real, tested contract instead of
guessing at one.

## Key concept: a profile page is a source-of-truth read, not a search

`/search/reviews` (Phase 5) already filters by `companyId` and would,
on the surface, seem to cover "list a company's reviews." It was
deliberately not reused here. The OpenSearch index is derived and
best-effort by design — D16 and D17 both say so explicitly, and
`CompaniesService.create()`'s indexing call is wrapped in a try/catch
that logs and swallows failures rather than failing the write. That's
the right tradeoff for a *search* feature, where a missed document
means a slightly incomplete result set. It's the wrong tradeoff for a
company's own profile page, where a missed document means the page
looks less credible than it is — a company with real approved reviews
that silently don't appear. `CompaniesService.findApprovedReviews()`
queries Postgres directly instead: slower to add filters to later,
strictly correct today.

## Key concept: verify existence, don't let an empty result imply it

A company that doesn't exist and a company that exists with zero
approved reviews are different facts, and they need different HTTP
responses — the first is a 404, the second is a valid empty page. The
naive version of `findApprovedReviews()` would just run the
`roundRating` query and return `{ total: 0, items: [] }` either way,
silently treating "not found" as "found and empty." The actual
implementation does a `findUniqueOrThrow` on the company first,
specifically so a bad ID produces the same 404 the rest of the API
already gives for missing resources — the same instinct that led
CLAUDE.md's ScoreDisplay convention to insist a `null` score never
render as `0`.

## System design approach

Two additions to the existing `companies` module:

```
GET /companies/by-slug/:slug   # two-segment path — can't collide with :id
GET /companies/:id/reviews     # paginated, approved-only, shaped for display
```

The reviews endpoint's response shape deliberately omits `candidateId`
— moderating and displaying content never requires knowing who wrote
it, the same principle the Phase 14 moderation-queue enrichment
applied. Pagination is a small `ListCompanyReviewsQueryDto`
(`page`/`pageSize`, capped at 50) using `class-transformer`'s `@Type()`
to coerce query-string values into numbers — the first place in the
codebase that decorator was needed, which surfaced a real gap: a bare
DTO unit test doesn't get `reflect-metadata` the way Nest's bootstrap
does, so the spec has to import it directly or every validator
decorator silently no-ops.

## Step-by-step: what actually got built

1. **`findBySlug()`** — one line, `findUniqueOrThrow({ where: { slug } })`,
   relying on the unique constraint the schema has carried since
   Phase 1.
2. **`findApprovedReviews()`** — existence check, then a `count` +
   `findMany` pair run in parallel via `Promise.all`, joined through to
   round title/type and role title for display.
3. **The pagination DTO**, plus the `reflect-metadata` fix once its
   unit test failed with `Reflect.getMetadata is not a function`.
4. **9 new unit tests** covering the existence check, the pagination
   math passed to Prisma, the no-`candidateId` shape, and the DTO's
   coercion/validation.
5. **5 e2e tests** (`company-reviews.e2e-spec.ts`) against real
   Postgres: slug 200/404, approved-only with a pending sibling
   excluded, pagination across two pages, unknown-company 404, invalid
   query params 400.
6. **A README refresh** — the API endpoint table had been labeled
   "Phase 2 slice" since Phase 2 and was missing everything built
   since; brought current through Phase 15.
7. **Live verification** against real data in kind's Postgres per D24:
   slug lookup, review shape, and a direct string-search confirming no
   response body ever contained a raw `candidateId`.

## What this enabled

Everything issue #141's page needed already existed by the time that
issue started — the profile page could be written as pure composition
against a tested contract, with the routing and rendering questions
being the only remaining unknowns.
