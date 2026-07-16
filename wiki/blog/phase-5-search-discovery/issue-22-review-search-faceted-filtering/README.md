# Phase 5, Issue #22 — Review Search with Faceted Filtering

*Part of Phase 5 — Search & discovery. See `docs/ROADMAP.md` Phase 5,
`docs/DECISIONS.md` D17, CLAUDE.md hard constraints #1/#2.*

## Why this came first

Issue #21 proved the OpenSearch integration pattern works, for the
simplest possible document (a company). Issue #22 is where that pattern
meets real complexity: reviews need to be filtered along several
independent facets at once (role, round type, date range) *combined*
with free-text relevance search — and, unlike companies, a review must
never be indexed until it's been through moderation. Getting both of
those right is the core of this issue, and it surfaces two genuinely
subtle OpenSearch query-DSL mistakes worth understanding deeply, since
both are easy to make in any faceted-search system.

## Core concept: `match` vs. `match_phrase` vs. `term` — three different
questions, easy to conflate

This is the single most transferable idea from this issue, useful in any
system built on an inverted-index search engine, not just OpenSearch:

- **`match`** performs *analyzed*, per-token search with OR semantics by
  default: searching `match: { freeText: "great fair" }` finds any
  document containing *either* "great" *or* "fair" (with documents
  containing both ranked higher) — appropriate for free-text relevance
  search, where you want partial, best-effort matching against natural
  language.
- **`match_phrase`** is also analyzed, but requires the tokens to appear
  *contiguously, in order* — `match_phrase: { roleTitle: "Staff Engineer
  X" }` only matches documents where those exact three tokens appear
  next to each other in that order, not documents merely containing all
  three tokens somewhere.
- **`term`** performs *exact*, unanalyzed matching against a `keyword`
  field — no tokenization at all, the field's stored value must equal
  the query value exactly (`term: { companyId: "..." }`).

**The real bug this issue found:** the original `roleTitle` filter used
`match` instead of `match_phrase`. Because `match`'s default OR semantics
treat "Staff Engineer X" as three independent tokens, filtering for
"Staff Engineer X" also matched a document whose `roleTitle` was "Product
Manager X" — purely because both strings happen to share the token "X"
(in practice, a shared unique test-run marker suffix used to keep test
data distinct, per Phase 2.2's testing-strategy discipline). A completely
unrelated role title matched, silently, because `match`'s semantics are
fundamentally about relevance ranking across possibly-partial matches,
not about "does this filter constrain the result set to only this
value." **The general lesson: a `text` field used as a filter (an
AND-like constraint that should narrow results, not an OR-like relevance
search that should broaden them) almost always wants `match_phrase`, not
`match` — reserve bare `match` for genuine free-text search fields where
partial, any-token-matches relevance ranking is the actual desired
behavior.** This bug was caught by an e2e test directly — not flaky, a
deterministic wrong result once the right data shape existed to expose
it.

## Key concepts (project-specific)

- **Two clause types compose into one query: `must` for relevance, `filter`
  for exact constraints.** OpenSearch's `bool` query lets you combine
  both in a single request — `must` clauses affect both matching *and*
  relevance scoring, `filter` clauses affect only matching (and are
  typically faster, since they can be cached without needing to compute a
  relevance score at all). This project's `search()` builds exactly this
  split: `q` (free text) and `roleTitle` (a phrase constraint) go in
  `must`; `companyId`, `roundType`, and the date range go in `filter` —
  matching each field's actual semantic role, not just "everything the
  caller happened to pass."
- **A `range` clause on a `date`-mapped field**, supporting `gte`/`lte`
  independently — a date-range filter that only sets one bound (only
  `dateFrom`, or only `dateTo`) should filter one-sided, not require
  both, which is why the query is built by conditionally spreading each
  bound in only if it was actually provided.
- **Indexing is gated on the moderation decision, not on write.** Unlike
  company indexing (which happens at creation, since a company has no
  moderation gate), a review is only ever indexed from inside
  `ModerationService.review()`, and only when `decision === 'approved'`
  — a `rejected`/`flagged` review is never indexed at all. This directly
  enforces CLAUDE.md hard constraint #2 (every rating starts pending,
  only visible once approved) at the search layer too, not just the
  Postgres read path — a pending or rejected review must never be
  discoverable through search, even though it exists in Postgres.
- **The indexed document itself never includes `candidateId`** (or
  anything that could de-anonymize an interviewer/recruiter) — enforced
  by what fields `indexReview()`'s payload even contains, structurally
  the same defense-in-depth choice Phase 1.2's schema made for
  interviewer/recruiter names (CLAUDE.md hard constraint #1): the data
  simply isn't there to leak, rather than relying on every future query
  to remember not to select it.

## System design approach

```typescript
async search(params: ReviewSearchParams): Promise<ReviewSearchResult[]> {
  const must: OpenSearchQueryClause[] = [];
  const filter: OpenSearchQueryClause[] = [];

  if (params.q) must.push({ match: { freeText: params.q } });
  if (params.roleTitle) must.push({ match_phrase: { roleTitle: params.roleTitle } });
  if (params.companyId) filter.push({ term: { companyId: params.companyId } });
  if (params.roundType) filter.push({ term: { roundType: params.roundType } });
  if (params.dateFrom ?? params.dateTo) {
    filter.push({ range: { createdAt: {
      ...(params.dateFrom ? { gte: params.dateFrom } : {}),
      ...(params.dateTo ? { lte: params.dateTo } : {}),
    } } });
  }

  const query = must.length || filter.length
    ? { bool: { ...(must.length ? { must } : {}), ...(filter.length ? { filter } : {}) } }
    : { match_all: {} };

  const { body } = await this.client.search({ index: REVIEWS_INDEX, body: { query } });
  // ...map hits back to ReviewSearchResult...
}
```

Two structural choices worth internalizing as a reusable template for
"faceted search with optional filters" in general:

- **Every filter is conditionally added, never always-present with a
  wildcard/null placeholder.** An unset filter simply isn't in the
  `must`/`filter` arrays at all, rather than being present with some
  "match anything" sentinel value — which is what correctly lets any
  subset of filters (individually or combined) narrow the result set,
  with `match_all` as the honest fallback when literally nothing was
  filtered.
- **The moderation hook is the single trigger point, not duplicated
  logic.** Extending `ModerationService.review()` (built in Phase 3) with
  one additional `if (decision === 'approved') await this.indexApprovedReview(...)`
  call — best-effort, after the DB transaction commits — means there is
  exactly one code path that can ever cause a review to become
  searchable, and it's the same code path that's the sole authority on a
  rating's moderation status in the first place. No second "is this
  approved" check needed anywhere in the search layer, because
  ineligible reviews were never indexed to begin with.

```typescript
// ModerationService, extended in this issue
private async review(id, decision, dto, flagReason?) {
  // ...existing transaction: update queue entry + rating status...
  if (decision === 'approved') {
    await this.indexApprovedReview(entry.entityId); // best-effort, after commit
  }
  return updatedEntry;
}
```

Indexing *after* the transaction commits (not inside it) is deliberate,
for the same reason as issue #21's best-effort framing: search indexing
needs its own separate read (joining `round_rating` → `round` → `process`
for `companyId`/`roleTitle`) that has no business holding the moderation
transaction open, and a transient indexing failure must never roll back
an already-decided moderation outcome.

## Step-by-step: what actually got built

1. **Extracted `isIndexAlreadyExistsError`** from issue #21's
   `CompanySearchService` into a shared `opensearch-errors.util.ts`, the
   moment a second service (`ReviewSearchService`) needed the identical
   check — a concrete example of "extract a shared utility when the
   *second* real consumer appears, not speculatively before the first
   one."
2. **Built `ReviewSearchService`** with its own `onModuleInit` index
   creation (a `reviews` index, distinct from `companies`), `indexReview()`,
   and `search()`.
3. **Extended `ModerationService.review()`** to call
   `reviewSearchService.indexReview()` after a successful `approved`
   decision, wrapped in its own try/catch (same best-effort pattern).
4. **Built `GET /search/reviews?q=&companyId=&roleTitle=&roundType=&
   dateFrom=&dateTo=`**, combining free-text and facet filters as
   described above.
5. **Wrote 11 unit tests** (mocked OpenSearch client + `ModerationService`
   wiring) and **7 integration tests** (`review-search.e2e-spec.ts`)
   against real Postgres + OpenSearch, proving: an approved review is
   searchable/filterable; pending and rejected reviews never appear at
   all; each filter narrows results correctly, individually and
   combined; an invalid `roundType` is rejected with `400`.
6. **Found and fixed the `match`-vs-`match_phrase` bug** described above,
   caught directly by one of these e2e tests.
7. **Found and fixed issue #21's fuzziness bug** while chasing what
   initially looked like unrelated flakiness in this issue's own test
   suite — re-running the full e2e suite roughly 25 times specifically
   to distinguish "genuinely flaky" from "deterministic, but depends on
   randomly-generated test data" before accepting either fix as correct.
8. **Bumped `test/jest-e2e.json`'s `testTimeout`** from Jest's 5-second
   default to 30 seconds — booting a full Nest app plus connections to
   *both* Postgres and OpenSearch in `beforeAll` measurably exceeded 5
   seconds under heavy repeated local test runs, a purely environmental
   fix unrelated to either relevance bug but discovered in the same
   debugging pass.

## What this enabled

Issue #23's search UI consumes this endpoint directly, combining any
subset of its filters through simple form inputs with zero additional
backend work. More broadly, this issue is where the project's search
layer graduated from "one simple document type" (issue #21) to "a real
faceted search API with multiple constraint types composed correctly" —
the `must`/`filter` split, and the `match`/`match_phrase`/`term`
distinction underlying it, is the exact template for any future entity
this project (or any other OpenSearch-backed system) needs to make
searchable with more than one kind of constraint.
