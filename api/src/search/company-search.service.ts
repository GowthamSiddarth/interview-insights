import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { OPENSEARCH_CLIENT } from './opensearch-client.provider';
import { isIndexAlreadyExistsError, isNotFoundError } from './opensearch-errors.util';
import { searchIndexName } from './search-index-name.util';

export interface IndexableCompany {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  sizeBucket: string;
}

export interface CompanySearchResult {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  sizeBucket: string;
}

// docs/ARCHITECTURE.md: search is a separate store, purpose-built for
// faceted search — not the source of truth. Company rows in Postgres
// remain authoritative; this index is derived and best-effort (see
// docs/DECISIONS.md D16 for why indexing failures never fail the
// underlying company write).
@Injectable()
export class CompanySearchService implements OnModuleInit {
  private readonly logger = new Logger(CompanySearchService.name);
  // Resolved at construction, not module load, so a test-set
  // OPENSEARCH_INDEX_PREFIX is honored (see search-index-name.util.ts).
  private readonly index = searchIndexName('companies');

  constructor(@Inject(OPENSEARCH_CLIENT) private readonly client: Client) {}

  // Always attempts creation rather than check-then-act (indices.exists,
  // then indices.create) — that has a race window: multiple app instances
  // starting concurrently (multiple test workers here; multiple replicas
  // in a real deployment) can all see "doesn't exist" and all try to
  // create it, and only one wins. Swallowing the resulting
  // resource_already_exists_exception is the idiomatic idempotent-create
  // pattern instead.
  async onModuleInit() {
    try {
      await this.client.indices.create({
        index: this.index,
        body: {
          mappings: {
            properties: {
              name: { type: 'text' },
              slug: { type: 'keyword' },
              industry: { type: 'keyword' },
              sizeBucket: { type: 'keyword' },
            },
          },
        },
      });
    } catch (err) {
      if (!isIndexAlreadyExistsError(err)) throw err;
    }
  }

  // `refresh: true` forces the document to be immediately searchable
  // rather than waiting for OpenSearch's default ~1s refresh interval —
  // deliberate, so "create a company, search for it" works within the same
  // request cycle (issue #21 acceptance criteria), not eventually.
  async indexCompany(company: IndexableCompany): Promise<void> {
    await this.client.index({
      index: this.index,
      id: company.id,
      body: {
        name: company.name,
        slug: company.slug,
        industry: company.industry,
        sizeBucket: company.sizeBucket,
      },
      refresh: true,
    });
  }

  // GitHub issue #406 (Phase 37) — no caller needed this before a company
  // could ever be un-created; seed-demo-data-undo.ts is the first. Same
  // best-effort D16/D17 shape as ReviewSearchService.removeReview(): a
  // not-found (e.g. the company was never approved, so never indexed) is
  // silently expected, any other failure is logged, never thrown.
  async removeCompany(id: string): Promise<void> {
    try {
      await this.client.delete({ index: this.index, id, refresh: true });
    } catch (err) {
      if (isNotFoundError(err)) return;
      this.logger.error(
        'Failed to remove company from OpenSearch',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async search(query: string): Promise<CompanySearchResult[]> {
    const { body } = await this.client.search({
      index: this.index,
      body: {
        query: {
          // No fuzziness: AUTO's edit-distance tolerance is meant for
          // typo correction on words, but it also lets two long numeric
          // tokens that happen to be a couple of digits apart fuzzy-match
          // each other (found via a genuinely flaky-looking e2e test — two
          // companies with different Date.now()-based identifiers matched
          // when they shouldn't have). Same risk applies to real slugs/names
          // containing numbers. Plain multi_match still gives partial/
          // multi-word matching via its default OR term semantics, without
          // that false-positive risk.
          multi_match: {
            query,
            fields: ['name^2', 'slug'],
          },
        },
      },
    });

    return (
      body.hits.hits as unknown as Array<{ _id: string; _source: Omit<IndexableCompany, 'id'> }>
    ).map((hit) => ({ id: hit._id, ...hit._source }));
  }
}
