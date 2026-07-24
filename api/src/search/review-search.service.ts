import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { RoundType } from '@prisma/client';
import { OPENSEARCH_CLIENT } from './opensearch-client.provider';
import { isIndexAlreadyExistsError, isNotFoundError } from './opensearch-errors.util';
import { searchIndexName } from './search-index-name.util';

export interface IndexableReview {
  id: string;
  companyId: string;
  roleTitle: string;
  roundType: RoundType;
  freeText: string | null;
  createdAt: Date;
  difficulty: number;
  fairness: number;
  communicationFluency: number;
  attentiveness: number;
  biasSignal: number;
}

export interface ReviewSearchParams {
  q?: string;
  companyId?: string;
  roleTitle?: string;
  roundType?: RoundType;
  dateFrom?: string;
  dateTo?: string;
}

export type ReviewSearchResult = IndexableReview;

interface OpenSearchQueryClause {
  match?: Record<string, string>;
  match_phrase?: Record<string, string>;
  term?: Record<string, string>;
  range?: Record<string, { gte?: string; lte?: string }>;
}

// Only ever indexes round_rating documents that have already been approved
// (called from ModerationService.review() — see docs/DECISIONS.md D16/D17)
// — never candidateId or anything that could identify a real
// interviewer/recruiter (CLAUDE.md hard constraint #1). Same
// synchronous, in-process, best-effort pattern as CompanySearchService:
// Postgres is the source of truth, this index is derived.
@Injectable()
export class ReviewSearchService implements OnModuleInit {
  private readonly logger = new Logger(ReviewSearchService.name);

  // Resolved at construction, not module load — same reasoning as
  // CompanySearchService.
  private readonly index = searchIndexName('reviews');

  constructor(@Inject(OPENSEARCH_CLIENT) private readonly client: Client) {}

  async onModuleInit() {
    try {
      await this.client.indices.create({
        index: this.index,
        body: {
          mappings: {
            properties: {
              companyId: { type: 'keyword' },
              roleTitle: { type: 'text' },
              roundType: { type: 'keyword' },
              freeText: { type: 'text' },
              createdAt: { type: 'date' },
              difficulty: { type: 'integer' },
              fairness: { type: 'integer' },
              communicationFluency: { type: 'integer' },
              attentiveness: { type: 'integer' },
              biasSignal: { type: 'integer' },
            },
          },
        },
      });
    } catch (err) {
      if (!isIndexAlreadyExistsError(err)) throw err;
    }
  }

  // `refresh: true` — same reasoning as CompanySearchService: approve a
  // rating, then search for it, should work within the same request cycle.
  async indexReview(review: IndexableReview): Promise<void> {
    await this.client.index({
      index: this.index,
      id: review.id,
      body: {
        companyId: review.companyId,
        roleTitle: review.roleTitle,
        roundType: review.roundType,
        freeText: review.freeText,
        createdAt: review.createdAt.toISOString(),
        difficulty: review.difficulty,
        fairness: review.fairness,
        communicationFluency: review.communicationFluency,
        attentiveness: review.attentiveness,
        biasSignal: review.biasSignal,
      },
      refresh: true,
    });
  }

  // Called from a candidate deleting their own round rating (GitHub
  // issue #150) — best-effort, same D16/D17 reasoning as indexReview:
  // Postgres is the source of truth and has already committed the
  // delete by the time this runs, so a not-found (never indexed —
  // pending/rejected/flagged at delete time) is silently expected, and
  // any other failure is logged, never thrown.
  async removeReview(id: string): Promise<void> {
    try {
      await this.client.delete({ index: this.index, id, refresh: true });
    } catch (err) {
      if (isNotFoundError(err)) return;
      this.logger.error(
        'Failed to remove review from OpenSearch',
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async search(params: ReviewSearchParams): Promise<ReviewSearchResult[]> {
    const must: OpenSearchQueryClause[] = [];
    const filter: OpenSearchQueryClause[] = [];

    if (params.q) must.push({ match: { freeText: params.q } });
    // match_phrase, not match: roleTitle is a filter (an AND-like "contains
    // this phrase" constraint), not a free-text relevance search — match's
    // per-token OR semantics would otherwise match "Product Manager X" when
    // filtering for "Staff Engineer X" just because they share a token.
    if (params.roleTitle) must.push({ match_phrase: { roleTitle: params.roleTitle } });
    if (params.companyId) filter.push({ term: { companyId: params.companyId } });
    if (params.roundType) filter.push({ term: { roundType: params.roundType } });
    if (params.dateFrom ?? params.dateTo) {
      filter.push({
        range: {
          createdAt: {
            ...(params.dateFrom ? { gte: params.dateFrom } : {}),
            ...(params.dateTo ? { lte: params.dateTo } : {}),
          },
        },
      });
    }

    const query =
      must.length || filter.length
        ? { bool: { ...(must.length ? { must } : {}), ...(filter.length ? { filter } : {}) } }
        : { match_all: {} };

    const { body } = await this.client.search({
      index: this.index,
      body: { query },
    });

    type RawReviewSource = Omit<IndexableReview, 'id' | 'createdAt'> & { createdAt: string };

    return (
      body.hits.hits as unknown as Array<{ _id: string; _source: RawReviewSource }>
    ).map((hit) => ({
      id: hit._id,
      ...hit._source,
      createdAt: new Date(hit._source.createdAt),
    }));
  }
}
