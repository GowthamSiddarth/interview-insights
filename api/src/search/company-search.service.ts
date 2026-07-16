import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { OPENSEARCH_CLIENT } from './opensearch-client.provider';

const COMPANIES_INDEX = 'companies';

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
        index: COMPANIES_INDEX,
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
      if (!this.isIndexAlreadyExistsError(err)) throw err;
    }
  }

  private isIndexAlreadyExistsError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null || !('body' in err)) return false;
    const body = (err as { body?: unknown }).body;
    if (typeof body !== 'object' || body === null || !('error' in body)) return false;
    const error = (body as { error?: unknown }).error;
    return (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      (error as { type?: unknown }).type === 'resource_already_exists_exception'
    );
  }

  // `refresh: true` forces the document to be immediately searchable
  // rather than waiting for OpenSearch's default ~1s refresh interval —
  // deliberate, so "create a company, search for it" works within the same
  // request cycle (issue #21 acceptance criteria), not eventually.
  async indexCompany(company: IndexableCompany): Promise<void> {
    await this.client.index({
      index: COMPANIES_INDEX,
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

  async search(query: string): Promise<CompanySearchResult[]> {
    const { body } = await this.client.search({
      index: COMPANIES_INDEX,
      body: {
        query: {
          multi_match: {
            query,
            fields: ['name^2', 'slug'],
            fuzziness: 'AUTO',
          },
        },
      },
    });

    return (
      body.hits.hits as unknown as Array<{ _id: string; _source: Omit<IndexableCompany, 'id'> }>
    ).map((hit) => ({ id: hit._id, ...hit._source }));
  }
}
