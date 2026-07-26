import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { ModerationEntityType } from '@prisma/client';
import { OPENSEARCH_CLIENT } from './opensearch-client.provider';
import { isIndexAlreadyExistsError, isNotFoundError } from './opensearch-errors.util';
import { searchIndexName } from './search-index-name.util';

// GitHub issue #370 (Phase 35) — the two-bucket category the moderator
// search/filter box uses: every interview-review entity type collapses
// into one value, a create-company request is the other.
export type ModerationQueueCategory = 'interview-review' | 'create-company';

export interface IndexableModerationQueueEntry {
  entityType: ModerationEntityType;
  entityId: string;
  category: ModerationQueueCategory;
  companyName: string;
  roleTitle: string | null;
  freeTextPreview: string | null;
  createdAt: Date;
}

export interface ModerationQueueSearchHit {
  entityType: ModerationEntityType;
  entityId: string;
}

interface OpenSearchQueryClause {
  term?: Record<string, string>;
  multi_match?: { query: string; fields: string[]; fuzziness?: string };
}

// A separate, dedicated index from the public companies/reviews ones
// (D16/D17) — this one exists purely to back a moderator's own
// search/filter box over the *pending* moderation queue, never surfaced
// publicly. Documents are keyed by `${entityType}:${entityId}` (not the
// moderation_queue row's own id) — every write-path caller already has
// entityType/entityId on hand at the exact points it needs to index or
// remove a document (enqueue/reenqueue/removeQueueEntries all take the
// same two arguments), so no extra lookup is needed to know which
// document to touch.
@Injectable()
export class ModerationQueueSearchService implements OnModuleInit {
  private readonly logger = new Logger(ModerationQueueSearchService.name);
  private readonly index = searchIndexName('moderation_queue');

  constructor(@Inject(OPENSEARCH_CLIENT) private readonly client: Client) {}

  // Same always-attempt-creation pattern as every other index (D16) —
  // swallows the race when multiple app instances start concurrently.
  async onModuleInit() {
    try {
      await this.client.indices.create({
        index: this.index,
        body: {
          mappings: {
            properties: {
              entityType: { type: 'keyword' },
              entityId: { type: 'keyword' },
              category: { type: 'keyword' },
              companyName: { type: 'text' },
              roleTitle: { type: 'text' },
              freeTextPreview: { type: 'text' },
              createdAt: { type: 'date' },
            },
          },
        },
      });
    } catch (err) {
      if (!isIndexAlreadyExistsError(err)) throw err;
    }
  }

  private docId(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  // `refresh: true` — same reasoning as every other index in this app: a
  // moderator submitting new content should be able to search for it
  // within the same request cycle, not after OpenSearch's ~1s default
  // refresh interval.
  async indexEntry(entry: IndexableModerationQueueEntry): Promise<void> {
    await this.client.index({
      index: this.index,
      id: this.docId(entry.entityType, entry.entityId),
      body: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        category: entry.category,
        companyName: entry.companyName,
        roleTitle: entry.roleTitle,
        freeTextPreview: entry.freeTextPreview,
        createdAt: entry.createdAt.toISOString(),
      },
      refresh: true,
    });
  }

  // Called whenever a queue entry stops being "pending" for any reason —
  // resolved (approve/reject/flag) or the underlying entity deleted.
  // Not-found is expected and silent (the entity may never have been
  // indexed, e.g. if the initial indexEntry() call itself failed).
  async removeEntry(entityType: string, entityId: string): Promise<void> {
    try {
      await this.client.delete({ index: this.index, id: this.docId(entityType, entityId), refresh: true });
    } catch (err) {
      if (isNotFoundError(err)) return;
      this.logger.error(
        'Failed to remove moderation queue entry from OpenSearch',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  // Genuinely fuzzy (unlike CompanySearchService's own search, D17) —
  // this index only ever holds short, human-authored text (company
  // names, role titles, free-text previews), not the long numeric
  // test-only identifiers that made fuzziness risky there.
  async search(
    q: string | undefined,
    category: ModerationQueueCategory | undefined,
  ): Promise<ModerationQueueSearchHit[]> {
    const must: OpenSearchQueryClause[] = [];
    const filter: OpenSearchQueryClause[] = [];

    if (q) {
      must.push({
        multi_match: {
          query: q,
          fields: ['companyName^2', 'roleTitle', 'freeTextPreview'],
          fuzziness: 'AUTO',
        },
      });
    }
    if (category) filter.push({ term: { category } });

    const query =
      must.length || filter.length
        ? { bool: { ...(must.length ? { must } : {}), ...(filter.length ? { filter } : {}) } }
        : { match_all: {} };

    const { body } = await this.client.search({
      index: this.index,
      body: { query },
    });

    return (
      body.hits.hits as unknown as Array<{
        _source: { entityType: ModerationEntityType; entityId: string };
      }>
    ).map((hit) => ({ entityType: hit._source.entityType, entityId: hit._source.entityId }));
  }
}
