import { Test, TestingModule } from '@nestjs/testing';
import { ReviewSearchService } from './review-search.service';
import { OPENSEARCH_CLIENT } from './opensearch-client.provider';

describe('ReviewSearchService', () => {
  let service: ReviewSearchService;
  let client: {
    indices: { create: jest.Mock };
    index: jest.Mock;
    search: jest.Mock;
    delete: jest.Mock;
  };

  const review = {
    id: 'rating-1',
    companyId: 'company-1',
    roleTitle: 'Senior Backend Engineer',
    roundType: 'coding' as const,
    freeText: 'Great round, fair questions',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    difficulty: 3,
    fluency: 4,
    clarity: 4,
    focus: 4,
  };

  beforeEach(async () => {
    client = {
      indices: { create: jest.fn() },
      index: jest.fn(),
      search: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReviewSearchService, { provide: OPENSEARCH_CLIENT, useValue: client }],
    }).compile();

    service = module.get(ReviewSearchService);
  });

  describe('onModuleInit', () => {
    it('creates the reviews index', async () => {
      client.indices.create.mockResolvedValue({});

      await service.onModuleInit();

      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'reviews' }),
      );
    });

    it('swallows a resource_already_exists_exception', async () => {
      client.indices.create.mockRejectedValue({
        body: { error: { type: 'resource_already_exists_exception' } },
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('indexReview', () => {
    it('indexes the review with an immediate refresh, storing createdAt as ISO', async () => {
      client.index.mockResolvedValue({});

      await service.indexReview(review);

      expect(client.index).toHaveBeenCalledWith({
        index: 'reviews',
        id: 'rating-1',
        body: {
          companyId: 'company-1',
          roleTitle: 'Senior Backend Engineer',
          roundType: 'coding',
          freeText: 'Great round, fair questions',
          createdAt: '2026-01-01T00:00:00.000Z',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
        },
        refresh: true,
      });
    });
  });

  describe('removeReview', () => {
    it('deletes the document by id with an immediate refresh', async () => {
      client.delete.mockResolvedValue({});

      await service.removeReview('rating-1');

      expect(client.delete).toHaveBeenCalledWith({ index: 'reviews', id: 'rating-1', refresh: true });
    });

    it('silently swallows a 404 (never indexed, or already removed)', async () => {
      client.delete.mockRejectedValue({ statusCode: 404 });

      await expect(service.removeReview('rating-1')).resolves.toBeUndefined();
    });

    it('does not throw on an unexpected error either — best-effort, logged only', async () => {
      client.delete.mockRejectedValue(new Error('OpenSearch unreachable'));

      await expect(service.removeReview('rating-1')).resolves.toBeUndefined();
    });
  });

  describe('search', () => {
    function mockHit() {
      client.search.mockResolvedValue({
        body: {
          hits: {
            hits: [
              {
                _id: 'rating-1',
                _source: {
                  companyId: 'company-1',
                  roleTitle: 'Senior Backend Engineer',
                  roundType: 'coding',
                  freeText: 'Great round, fair questions',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  difficulty: 3,
                  fluency: 4,
                  clarity: 4,
                  focus: 4,
                },
              },
            ],
          },
        },
      });
    }

    it('parses createdAt back into a Date', async () => {
      mockHit();

      const results = await service.search({});

      expect(results[0].createdAt).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    });

    it('does a match_all query when no params are given', async () => {
      mockHit();

      await service.search({});

      expect(client.search).toHaveBeenCalledWith({
        index: 'reviews',
        body: { query: { match_all: {} } },
      });
    });

    it('builds a bool query with must clauses for q/roleTitle and filter clauses for companyId/roundType/date range', async () => {
      mockHit();

      await service.search({
        q: 'fair',
        roleTitle: 'Engineer',
        companyId: 'company-1',
        roundType: 'coding',
        dateFrom: '2026-01-01',
        dateTo: '2026-02-01',
      });

      expect(client.search).toHaveBeenCalledWith({
        index: 'reviews',
        body: {
          query: {
            bool: {
              must: [
                { match: { freeText: 'fair' } },
                { match_phrase: { roleTitle: 'Engineer' } },
              ],
              filter: [
                { term: { companyId: 'company-1' } },
                { term: { roundType: 'coding' } },
                { range: { createdAt: { gte: '2026-01-01', lte: '2026-02-01' } } },
              ],
            },
          },
        },
      });
    });

    it('returns an empty array when nothing matches', async () => {
      client.search.mockResolvedValue({ body: { hits: { hits: [] } } });

      await expect(service.search({ q: 'nonexistent' })).resolves.toEqual([]);
    });
  });
});
