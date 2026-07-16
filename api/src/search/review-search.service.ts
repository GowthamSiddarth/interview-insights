import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';
import { RoundType } from '@prisma/client';
import { OPENSEARCH_CLIENT } from './opensearch-client.provider';
import { isIndexAlreadyExistsError } from './opensearch-errors.util';

const REVIEWS_INDEX = 'reviews';

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
  constructor(@Inject(OPENSEARCH_CLIENT) private readonly client: Client) {}

  async onModuleInit() {
    try {
      await this.client.indices.create({
        index: REVIEWS_INDEX,
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
      index: REVIEWS_INDEX,
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
      index: REVIEWS_INDEX,
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
