import { Test, TestingModule } from '@nestjs/testing';
import { ModerationQueueSearchService } from './moderation-queue-search.service';
import { OPENSEARCH_CLIENT } from './opensearch-client.provider';

describe('ModerationQueueSearchService', () => {
  let service: ModerationQueueSearchService;
  let client: {
    indices: { create: jest.Mock };
    index: jest.Mock;
    search: jest.Mock;
    delete: jest.Mock;
  };

  const entry = {
    entityType: 'round_rating' as const,
    entityId: 'rating-1',
    category: 'interview-review' as const,
    companyName: 'Acme Corp',
    roleTitle: 'Senior Backend Engineer',
    freeTextPreview: 'Great round, fair questions',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    client = {
      indices: { create: jest.fn() },
      index: jest.fn(),
      search: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ModerationQueueSearchService, { provide: OPENSEARCH_CLIENT, useValue: client }],
    }).compile();

    service = module.get(ModerationQueueSearchService);
  });

  describe('onModuleInit', () => {
    it('creates the moderation_queue index', async () => {
      client.indices.create.mockResolvedValue({});

      await service.onModuleInit();

      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'moderation_queue' }),
      );
    });

    it('swallows a resource_already_exists_exception', async () => {
      client.indices.create.mockRejectedValue({
        body: { error: { type: 'resource_already_exists_exception' } },
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('indexEntry', () => {
    it('indexes the entry keyed by entityType:entityId, with an immediate refresh', async () => {
      client.index.mockResolvedValue({});

      await service.indexEntry(entry);

      expect(client.index).toHaveBeenCalledWith({
        index: 'moderation_queue',
        id: 'round_rating:rating-1',
        body: {
          entityType: 'round_rating',
          entityId: 'rating-1',
          category: 'interview-review',
          companyName: 'Acme Corp',
          roleTitle: 'Senior Backend Engineer',
          freeTextPreview: 'Great round, fair questions',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        refresh: true,
      });
    });
  });

  describe('removeEntry', () => {
    it('deletes the document keyed by entityType:entityId, with an immediate refresh', async () => {
      client.delete.mockResolvedValue({});

      await service.removeEntry('round_rating', 'rating-1');

      expect(client.delete).toHaveBeenCalledWith({
        index: 'moderation_queue',
        id: 'round_rating:rating-1',
        refresh: true,
      });
    });

    it('silently swallows a 404 (never indexed, or already removed)', async () => {
      client.delete.mockRejectedValue({ statusCode: 404 });

      await expect(service.removeEntry('round_rating', 'rating-1')).resolves.toBeUndefined();
    });

    it('does not throw on an unexpected error either — best-effort, logged only', async () => {
      client.delete.mockRejectedValue(new Error('OpenSearch unreachable'));

      await expect(service.removeEntry('round_rating', 'rating-1')).resolves.toBeUndefined();
    });
  });

  describe('search', () => {
    function mockHits() {
      client.search.mockResolvedValue({
        body: {
          hits: {
            hits: [
              { _source: { entityType: 'round_rating', entityId: 'rating-1' } },
              { _source: { entityType: 'company', entityId: 'company-1' } },
            ],
          },
        },
      });
    }

    it('does a match_all query when neither q nor category is given', async () => {
      mockHits();

      await service.search(undefined, undefined);

      expect(client.search).toHaveBeenCalledWith({
        index: 'moderation_queue',
        body: { query: { match_all: {} } },
      });
    });

    it('builds a fuzzy multi_match query for q, over companyName/roleTitle/freeTextPreview', async () => {
      mockHits();

      await service.search('acme', undefined);

      expect(client.search).toHaveBeenCalledWith({
        index: 'moderation_queue',
        body: {
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query: 'acme',
                    fields: ['companyName^2', 'roleTitle', 'freeTextPreview'],
                    fuzziness: 'AUTO',
                  },
                },
              ],
            },
          },
        },
      });
    });

    it('adds a category term filter', async () => {
      mockHits();

      await service.search(undefined, 'create-company');

      expect(client.search).toHaveBeenCalledWith({
        index: 'moderation_queue',
        body: {
          query: {
            bool: {
              filter: [{ term: { category: 'create-company' } }],
            },
          },
        },
      });
    });

    it('combines q and category into one bool query', async () => {
      mockHits();

      await service.search('acme', 'interview-review');

      expect(client.search).toHaveBeenCalledWith({
        index: 'moderation_queue',
        body: {
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query: 'acme',
                    fields: ['companyName^2', 'roleTitle', 'freeTextPreview'],
                    fuzziness: 'AUTO',
                  },
                },
              ],
              filter: [{ term: { category: 'interview-review' } }],
            },
          },
        },
      });
    });

    it('maps hits down to just entityType/entityId', async () => {
      mockHits();

      const results = await service.search('acme', undefined);

      expect(results).toEqual([
        { entityType: 'round_rating', entityId: 'rating-1' },
        { entityType: 'company', entityId: 'company-1' },
      ]);
    });

    it('returns an empty array when nothing matches', async () => {
      client.search.mockResolvedValue({ body: { hits: { hits: [] } } });

      await expect(service.search('nonexistent', undefined)).resolves.toEqual([]);
    });
  });
});
