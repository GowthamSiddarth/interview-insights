# Phase 5, Issue #21 — OpenSearch Setup & Company Search

*Part of Phase 5 — Search & discovery. See `docs/ROADMAP.md` Phase 5,
`docs/ARCHITECTURE.md` "Why this shape", `docs/DECISIONS.md` D9/D16.*

This post goes deeper than earlier ones — it's the first time this
project introduces a genuinely new kind of datastore, and the concepts
here (inverted indexes, mapping types, idempotent index creation, best-
effort dual-write) are reusable well beyond this specific app.

## Why this came first

Every entity lookup so far in this project has gone through Postgres,
using exact ID lookups or simple `WHERE` filters. Phase 5's whole premise
is that a real product needs *search* — "find companies whose name looks
like what I typed," "find reviews mentioning a role, filtered by round
type and date" — and Postgres's built-in full-text search doesn't scale
well to that kind of faceted, relevance-ranked lookup
(`docs/ARCHITECTURE.md` says so explicitly). Issue #21 is where a
second datastore, purpose-built for this, enters the project for the
first time.

## Core concept: what OpenSearch actually is, and why it's different from Postgres

OpenSearch (a fork of Elasticsearch) is built around an **inverted
index** — conceptually the opposite structure of how a relational
database stores rows. A relational table stores each row's full set of
column values together; a `WHERE name LIKE '%acme%'` query has to scan
that structure looking for matches. An inverted index instead stores, for
every distinct *token* (word) that appears anywhere in the indexed
`text` fields, the list of documents containing that token — so a search
for "acme" is a direct lookup into that token's posting list, not a scan.
This is what makes relevance-ranked, partial-word, faceted search fast at
scale in a way exact-match `WHERE` clauses aren't designed for.

Two OpenSearch-specific concepts show up directly in this issue's code
and are worth understanding on their own, independent of this project:

- **Mapping types (`text` vs `keyword`) decide *how* a field is
  indexed, and getting this wrong silently breaks either search or
  filtering.** A `text` field is analyzed — broken into tokens (usually
  lowercased, split on whitespace/punctuation) before indexing, which is
  what enables partial and relevance-ranked matching. A `keyword` field
  is indexed as one exact, unanalyzed string — no tokenization at all,
  which is what makes it suitable for exact-match filtering, sorting, and
  aggregations. This project's `companies` index mapping makes this
  choice deliberately per field: `name: { type: 'text' }` (you want
  "acme" to match "Acme Corp"), `slug: { type: 'keyword' }` (a slug is
  either the exact slug or it isn't — no partial-match search makes sense
  for it).
- **`refresh: true` and near-real-time search.** OpenSearch doesn't make
  a newly indexed document searchable the instant it's written — by
  default there's a roughly one-second refresh interval before a new
  segment becomes visible to search. Passing `refresh: true` on the index
  call forces an immediate refresh, at a real cost (more frequent
  refreshes are less efficient at scale) — a deliberate tradeoff made
  here specifically because "create a company, then immediately search
  for it" is a real acceptance criterion (and something Phase 2.3-style
  browser/e2e verification would otherwise fail on intermittently,
  depending on timing).

## Key concepts (project-specific)

- **Best-effort, in-process, synchronous indexing — a different
  reliability contract than moderation's enqueue.** Phase 3's moderation
  queue write happens in the *same transaction* as the rating —
  correctly, since a rating without a moderation entry would be
  unreviewable forever. Company search indexing is different: OpenSearch
  is a *derived* index, not the source of truth (Postgres is), so a
  transient indexing failure must never fail — or roll back — the
  underlying company creation. This is `docs/DECISIONS.md` D16's core
  distinction, and it's the general pattern for keeping a secondary,
  derived datastore in sync with a primary one without coupling their
  failure modes: write to the source of truth first, then best-effort
  (try/catch, log, never rethrow) propagate to the derived store.
- **Idempotent index creation beats check-then-act.** A naive
  `if (!await indices.exists()) await indices.create()` has a race
  window: two app instances (or, concretely, two parallel Jest test
  workers) can both check, both see "doesn't exist," and both attempt
  creation — one wins, one gets a `resource_already_exists_exception`.
  The fix generalizes well beyond OpenSearch indexes: **always attempt
  the create, and treat "already exists" as success, not failure** — the
  same idempotent-creation pattern used for `CREATE TABLE IF NOT EXISTS`
  in SQL, `mkdir -p` in a shell, or a Kubernetes `kubectl apply` (create
  or update, never "fail because it's already there").

## System design approach

```typescript
async onModuleInit() {
  try {
    await this.client.indices.create({
      index: COMPANIES_INDEX,
      body: { mappings: { properties: {
        name: { type: 'text' },
        slug: { type: 'keyword' },
        industry: { type: 'keyword' },
        sizeBucket: { type: 'keyword' },
      } } },
    });
  } catch (err) {
    if (!isIndexAlreadyExistsError(err)) throw err;
  }
}
```

`isIndexAlreadyExistsError` inspects the OpenSearch client error's nested
`err.body.error.type` field for the specific string
`resource_already_exists_exception` — anything else rethrows, since a
*different* failure (e.g. the cluster being unreachable) should still
surface loudly at boot, not be silently swallowed alongside the one
specific error this pattern is designed to tolerate.

The write-path integration — indexing a company right after its Postgres
row is created — is the concrete shape of the best-effort principle:

```typescript
async create(dto: CreateCompanyDto) {
  const company = await this.prisma.company.create({ data: dto });
  try {
    await this.companySearchService.indexCompany(company);
  } catch (err) {
    this.logger.error('Failed to index company in OpenSearch', /* ... */);
  }
  return company; // succeeds even if indexing failed
}
```

Note what's *not* here: no retry queue, no dead-letter mechanism, no
background reconciliation job for companies that failed to index. That's
a deliberate, named gap (revisit once there's a second consumer of
company-creation events, or indexing latency becomes observably
significant) rather than an oversight — the same "ship the honest,
simple version, name the limitation" discipline as D9/D13.

Search itself is a `multi_match` query across two fields, weighted:

```typescript
const { body } = await this.client.search({
  index: COMPANIES_INDEX,
  body: { query: { multi_match: { query, fields: ['name^2', 'slug'] } } },
});
```

`name^2` boosts matches in `name` to twice the relevance weight of a
match in `slug` — a company search for "acme" should rank a name match
above a slug-only match, and `^2` is OpenSearch's query-DSL syntax for
per-field relevance boosting in a `multi_match` query.

## A real relevance bug, and the general lesson in it

The original query used `fuzziness: 'AUTO'` on the `multi_match`, meant
to tolerate typos (matching "Acem Corp" against "Acme Corp"). This caused
a genuinely surprising failure: two companies with different
`Date.now()`-based test-generated identifiers in their names matched
each other, because their long numeric substrings happened to be only a
couple of edit-distance steps apart. This looked exactly like a flaky
test at first (re-running it sometimes passed) — it wasn't flaky at all;
it was a fully deterministic false-positive match that only *appeared*
random because it depended on how close two independently-generated
timestamps landed, run to run. Confirming this took ~25 repeated runs
specifically to rule out real environmental flakiness before accepting
"this is a deterministic bug" as the explanation — a useful habit:
**a bug that looks intermittent is not the same as a bug that is
actually random; re-running until you understand *why* it varies is
different from re-running until it happens to pass.**

The general, transferable lesson: **fuzzy matching's edit-distance
tolerance, tuned for typo-correction on natural-language words, applies
just as readily (and much more dangerously) to any numeric or ID-like
substring in the same field.** Removing `fuzziness` entirely was the
right fix here, because real company names and slugs in this product
don't need typo tolerance badly enough to risk this failure mode; a
system that genuinely needs both would need a more careful mapping
(e.g. a separate, non-fuzzy `keyword` sub-field for anything ID-like).

## Step-by-step: what actually got built

1. **Added `opensearch` as a default service** in `infra/docker-
   compose.yml` — single-node, security plugin disabled for local dev —
   the first real trigger to add it (per the "add a service the same day
   code needs it" discipline from Phase 1.3).
2. **Built the `OPENSEARCH_CLIENT` provider** — a NestJS custom provider
   token wrapping `@opensearch-project/opensearch`'s `Client`,
   constructed from an `OPENSEARCH_URL` env var.
3. **Built `CompanySearchService`** with the idempotent `onModuleInit`
   index-creation pattern, an `indexCompany()` method, and a `search()`
   method.
4. **Wired `indexCompany()` into `CompaniesService.create()`**,
   best-effort, right after the Postgres write.
5. **Built `GET /search/companies?q=`**, returning a plain array (empty,
   not an error, when nothing matches).
6. **Wrote 9 unit tests** (mocked OpenSearch client) covering index
   creation, the race-swallowing behavior, indexing, and search result
   mapping.
7. **Wrote 4 integration tests** against a real OpenSearch + Postgres,
   proving a created company is searchable within the same request
   cycle, ranks a closer name match above a looser one, and returns an
   empty array for no matches.
8. **Found and fixed the concurrency bug** (check-then-act race) and,
   one issue later while building issue #22, **found and fixed the
   fuzziness relevance bug** described above — both retroactively
   documented in `docs/DECISIONS.md` D16.

## What this enabled

The idempotent-create pattern and the best-effort dual-write pattern
established here were reused verbatim by issue #22's `ReviewSearchService`
(the shared `isIndexAlreadyExistsError` util was extracted specifically
because a second consumer needed the exact same logic) — proof that
getting the pattern right once, generally, paid off immediately rather
than needing rediscovery. The fuzziness bug's fix also applied backward:
it wasn't specific to issue #22's new code, it was a latent risk in this
issue's own query from the moment `fuzziness: 'AUTO'` was added.
