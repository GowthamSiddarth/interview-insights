# Phase 35, Issue #370 — New Moderation-Queue OpenSearch Index + Fuzzy Search Endpoint

*Part of Phase 35 — Moderated Company Creation & Moderator Search. See
`docs/ROADMAP.md` Phase 35 and `docs/DECISIONS.md` D59.*

## The gap this closed

The moderation queue had no search or filter capability at all —
finding one specific entry meant scrolling the entire grouped list.
With company creation now also flowing through moderation (issue
#369), the queue only gets busier. This issue builds a genuinely fuzzy
search over it, backed by a new dedicated OpenSearch index.

## Key concept: key documents by what every caller already has

The first real design question: how should documents in the new index
be keyed? The issue's own design sketch suggested the moderation queue
entry's own id (`queueEntryId`). But every single call site that would
ever need to index or remove a document — `enqueue()`, `reenqueue()`,
`removeQueueEntries()`, and `review()`'s own `entry.entityType`/
`entry.entityId` — already has exactly `entityType` and `entityId` on
hand, never the queue entry's own id without an extra lookup. So
documents are keyed by `${entityType}:${entityId}` instead:

```ts
private docId(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}
```

Every write-path service can index or remove a document with the exact
two values it already has, no extra query required.

## Key concept: indexing centralizes in `ModerationService`, not five separate services

`enqueue()` and `reenqueue()` run *inside* their caller's own
transaction — but OpenSearch indexing must never happen before that
transaction actually commits (the same D16/D17 reasoning
`indexApprovedReview`/`indexApprovedCompany` already established).
Rather than have each of the five write-path services fetch its own
company/role/free-text fields and call the search service directly —
duplicating that per-type lookup logic five times over — a single new
`ModerationService.indexForSearch(entityType, entityId)` re-derives the
display fields fresh from Postgres and does the indexing itself. Each
caller adds exactly one line, after its own transaction resolves:

```ts
async create(roundId: string, candidateId: string, dto: CreateRoundRatingDto) {
  const rating = await this.prisma.$transaction(async (tx) => { /* ... */ });
  await this.moderationService.indexForSearch('round_rating', rating.id);
  return rating;
}
```

`BulkProcessSubmissionService` collects the ids of every rateable
entity it creates during its own transaction, then indexes each one
afterward — the same pattern, just batched.

## Key concept: `enrichEntries()` — one enrichment path, two callers

`listPending()`'s per-type `Promise.allSettled` enrichment (round
rating / recruiter rating / overall review / company, including the
D37 transient-failure handling) already existed. The new `search()`
needs the identical "turn raw queue rows into fully-enriched entries"
logic, just over a different input set — the entities OpenSearch says
matched, not "everything currently pending." Rather than duplicate
that logic, it's extracted into a shared private `enrichEntries()`
method both callers use:

```ts
async search(q, category) {
  const hits = await this.moderationQueueSearchService.search(q, category);
  if (hits.length === 0) return [];
  const entries = await this.prisma.moderationQueueEntry.findMany({
    where: { reviewedAt: null, OR: hits.map((h) => ({ entityType: h.entityType, entityId: h.entityId })) },
  });
  const enrichedEntries = await this.enrichEntries(entries);
  // preserve OpenSearch's own relevance order
  const orderIndex = new Map(hits.map((h, i) => [`${h.entityType}:${h.entityId}`, i]));
  return [...enrichedEntries].sort((a, b) => /* ... */);
}
```

`search()` returns a flat list, not grouped by submission the way
`listPending()` is — a query can legitimately match entries from many
unrelated submissions, so grouping would mostly produce one-entry
groups anyway.

## Key concept: fuzziness is safe here, unlike once before

D17 (Phase 5) found that `fuzziness: 'AUTO'` on `CompanySearchService`'s
own query was a real bug: two long numeric test-identifier tokens a few
digits apart could fuzzy-match each other, since `AUTO`'s edit-distance
tolerance was designed for typo correction on words, not comparing
near-identical long numbers. That finding doesn't transfer here — this
index only ever holds short, human-authored text (company names, role
titles, free-text previews), genuinely benefiting from typo tolerance
with none of the numeric-token risk. Confirmed live, not just assumed:
a real e2e test proves a transposed-character typo query still finds
the right company.

## Key concept: the controller gets a new sibling route without moving anything

`ModerationController`'s base path changed from `moderation/queue` to
plain `moderation`, with each existing route's own decorator gaining
the `queue` prefix directly (`@Get('queue')`, `@Post('queue/:id/approve')`,
etc.) — so the new `GET /moderation/search` can be a sibling of
`/moderation/queue` rather than nested under it. Every existing route's
actual URL is completely unchanged; the frontend and every e2e test
that calls `/moderation/queue/...` needed zero updates.

## Step-by-step: what actually got built and verified

1. New `ModerationQueueSearchService` (`api/src/search/`): a dedicated
   `moderation_queue` index, `indexEntry`/`removeEntry` keyed by
   `entityType:entityId`, and a `search()` building a fuzzy
   `multi_match` (optionally combined with a `category` term filter).
2. `ModerationService` gained `indexForSearch`/`removeFromSearchIndex`/
   `search`, and `enrichEntries()` was extracted from `listPending()`.
   `review()` now always removes the resolved entry from the search
   index regardless of decision.
3. All five write-path services (round ratings, recruiter ratings,
   overall reviews, companies, bulk submission) wired to call
   `indexForSearch`/`removeFromSearchIndex` after their own transaction
   commits.
4. New `GET /moderation/search?q=&category=`, `AdminJwtAuthGuard`-gated
   via the controller's own guard.
5. 51 new/updated api unit tests (the new search service from scratch,
   `ModerationService`'s new methods, mock updates across all five
   write-path spec files) plus a new dedicated
   `moderation-search.e2e-spec.ts` (8 tests: same-request-cycle
   indexing for both categories, the genuine fuzzy-typo case, a
   resolved entity disappearing, the category filter, an edit
   reindexing a previously-resolved entity, and unauthenticated 401) —
   all green, full e2e suite and the golden-path smoke test stayed
   green too.
6. Live-verified against the real `kind` cluster via curl: a newly
   requested company became searchable immediately, a
   transposed-character typo still found it, the category filter
   narrowed correctly both directions, and approving it removed it
   from search results.

## What this enabled

The moderation queue has a real search/filter capability for the first
time, and issue #371 (the moderator-facing UI for this endpoint) had a
solid, well-tested backend to build directly on top of.
