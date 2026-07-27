import { Test, TestingModule } from '@nestjs/testing';
import { CompanySearchService } from './company-search.service';
import { OPENSEARCH_CLIENT } from './opensearch-client.provider';

describe('CompanySearchService', () => {
  let service: CompanySearchService;
  let client: {
    indices: { create: jest.Mock };
    index: jest.Mock;
    search: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    client = {
      indices: { create: jest.fn() },
      index: jest.fn(),
      search: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [CompanySearchService, { provide: OPENSEARCH_CLIENT, useValue: client }],
    }).compile();

    service = module.get(CompanySearchService);
  });

  describe('onModuleInit', () => {
    it('creates the companies index', async () => {
      client.indices.create.mockResolvedValue({});

      await service.onModuleInit();

      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'companies' }),
      );
    });

    it('swallows a resource_already_exists_exception (a concurrent instance won the race)', async () => {
      client.indices.create.mockRejectedValue({
        body: { error: { type: 'resource_already_exists_exception' } },
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });

    it('rethrows any other error', async () => {
      client.indices.create.mockRejectedValue({
        body: { error: { type: 'some_other_error' } },
      });

      await expect(service.onModuleInit()).rejects.toBeDefined();
    });
  });

  describe('indexCompany', () => {
    it('indexes the company with an immediate refresh so it is searchable right away', async () => {
      client.index.mockResolvedValue({});

      await service.indexCompany({
        id: 'company-1',
        name: 'Acme Corp',
        slug: 'acme-corp',
        industry: 'fintech',
        sizeBucket: 'mid',
      });

      expect(client.index).toHaveBeenCalledWith({
        index: 'companies',
        id: 'company-1',
        body: { name: 'Acme Corp', slug: 'acme-corp', industry: 'fintech', sizeBucket: 'mid' },
        refresh: true,
      });
    });
  });

  describe('removeCompany', () => {
    it('deletes the document by id with an immediate refresh', async () => {
      client.delete.mockResolvedValue({});

      await service.removeCompany('company-1');

      expect(client.delete).toHaveBeenCalledWith({ index: 'companies', id: 'company-1', refresh: true });
    });

    it('silently swallows a 404 (never indexed, or already removed)', async () => {
      client.delete.mockRejectedValue({ statusCode: 404 });

      await expect(service.removeCompany('company-1')).resolves.toBeUndefined();
    });

    it('does not throw on an unexpected error either — best-effort, logged only', async () => {
      client.delete.mockRejectedValue(new Error('OpenSearch unreachable'));

      await expect(service.removeCompany('company-1')).resolves.toBeUndefined();
    });
  });

  describe('search', () => {
    it('maps hits into flat company results', async () => {
      client.search.mockResolvedValue({
        body: {
          hits: {
            hits: [
              {
                _id: 'company-1',
                _source: { name: 'Acme Corp', slug: 'acme-corp', industry: null, sizeBucket: 'mid' },
              },
            ],
          },
        },
      });

      const results = await service.search('acme');

      expect(results).toEqual([
        { id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', industry: null, sizeBucket: 'mid' },
      ]);
      expect(client.search).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'companies' }),
      );
    });

    it('returns an empty array when nothing matches', async () => {
      client.search.mockResolvedValue({ body: { hits: { hits: [] } } });

      await expect(service.search('nonexistent')).resolves.toEqual([]);
    });
  });
});
