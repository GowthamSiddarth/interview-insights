import { Test, TestingModule } from '@nestjs/testing';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompanySearchService } from '../search/company-search.service';

describe('CompaniesService', () => {
  let service: CompaniesService;
  let prisma: {
    company: { create: jest.Mock; findUniqueOrThrow: jest.Mock };
    roundRating: { count: jest.Mock; findMany: jest.Mock };
  };
  let companySearchService: { indexCompany: jest.Mock };

  const dto = { name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' as const };
  const createdCompany = {
    id: 'company-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
    industry: null,
    sizeBucket: 'mid',
    logoUrl: null,
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      company: {
        create: jest.fn().mockResolvedValue(createdCompany),
        findUniqueOrThrow: jest.fn().mockResolvedValue(createdCompany),
      },
      roundRating: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    companySearchService = { indexCompany: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompanySearchService, useValue: companySearchService },
      ],
    }).compile();

    service = module.get(CompaniesService);
  });

  it('indexes the newly created company in OpenSearch', async () => {
    await service.create(dto);

    expect(companySearchService.indexCompany).toHaveBeenCalledWith(createdCompany);
  });

  it('still returns the created company even if search indexing fails', async () => {
    companySearchService.indexCompany.mockRejectedValue(new Error('OpenSearch unreachable'));

    const result = await service.create(dto);

    expect(result).toEqual(createdCompany);
  });

  describe('findBySlug', () => {
    it('looks the company up by its unique slug', async () => {
      await service.findBySlug('acme-corp');

      expect(prisma.company.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { slug: 'acme-corp' },
      });
    });
  });

  describe('findApprovedReviews', () => {
    it('verifies the company exists before querying (404 rather than an empty page)', async () => {
      await service.findApprovedReviews('company-1', 1, 10);

      expect(prisma.company.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'company-1' },
      });
    });

    it('queries every approved rating for the company, unpaginated at the row level', async () => {
      await service.findApprovedReviews('company-1', 3, 10);

      expect(prisma.roundRating.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'approved', round: { process: { companyId: 'company-1' } } },
          orderBy: { createdAt: 'desc' },
        }),
      );
      // No skip/take here — pagination now happens after grouping, over
      // submissions, not raw rows (GitHub issue #347).
      expect(prisma.roundRating.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ skip: expect.anything() as number }),
      );
    });

    // GitHub issue #347: a candidate's multi-round submission must appear
    // as one grouped item, not one row per round — the same flat-list
    // problem Phase 29 issue #315 already fixed for the moderation queue.
    it('groups multiple approved ratings from the same process into one item', async () => {
      prisma.roundRating.findMany.mockResolvedValue([
        {
          id: 'rating-1',
          candidateId: 'candidate-1',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: 'solid round',
          createdAt: new Date('2026-01-02'),
          round: {
            title: 'Screen',
            roundType: 'coding',
            processId: 'process-1',
            process: { roleTitle: 'Engineer' },
          },
        },
        {
          id: 'rating-2',
          candidateId: 'candidate-1',
          difficulty: 4,
          fluency: 3,
          clarity: 3,
          focus: 3,
          technicalDepth: null,
          freeText: null,
          createdAt: new Date('2026-01-01'),
          round: {
            title: 'Onsite',
            roundType: 'system_design',
            processId: 'process-1',
            process: { roleTitle: 'Engineer' },
          },
        },
      ]);

      const result = await service.findApprovedReviews('company-1', 1, 10);

      expect(result).toMatchObject({ total: 1, page: 1, pageSize: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ processId: 'process-1', roleTitle: 'Engineer' });
      expect(result.items[0].entries).toHaveLength(2);
      expect(result.items[0].entries[0]).toMatchObject({ id: 'rating-1', roundTitle: 'Screen' });
      expect(result.items[0].entries[1]).toMatchObject({ id: 'rating-2', roundTitle: 'Onsite' });
      expect(JSON.stringify(result)).not.toContain('candidate-1');
    });

    it('puts ratings from different processes into separate items', async () => {
      prisma.roundRating.findMany.mockResolvedValue([
        {
          id: 'rating-1',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: null,
          createdAt: new Date('2026-01-02'),
          round: {
            title: 'Screen',
            roundType: 'coding',
            processId: 'process-1',
            process: { roleTitle: 'Engineer' },
          },
        },
        {
          id: 'rating-2',
          difficulty: 4,
          fluency: 3,
          clarity: 3,
          focus: 3,
          technicalDepth: null,
          freeText: null,
          createdAt: new Date('2026-01-01'),
          round: {
            title: 'Screen',
            roundType: 'coding',
            processId: 'process-2',
            process: { roleTitle: 'Manager' },
          },
        },
      ]);

      const result = await service.findApprovedReviews('company-1', 1, 10);

      expect(result.total).toBe(2);
      expect(result.items.map((i) => i.processId)).toEqual(['process-1', 'process-2']);
    });

    it('paginates by submission, not raw row — a page boundary never splits one submission', async () => {
      prisma.roundRating.findMany.mockResolvedValue([
        {
          id: 'rating-1',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: null,
          createdAt: new Date('2026-01-03'),
          round: { title: 'A', roundType: 'coding', processId: 'process-1', process: { roleTitle: 'Engineer' } },
        },
        {
          id: 'rating-2',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: null,
          createdAt: new Date('2026-01-02'),
          round: { title: 'B', roundType: 'coding', processId: 'process-1', process: { roleTitle: 'Engineer' } },
        },
        {
          id: 'rating-3',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: null,
          createdAt: new Date('2026-01-01'),
          round: { title: 'A', roundType: 'coding', processId: 'process-2', process: { roleTitle: 'Manager' } },
        },
      ]);

      const page1 = await service.findApprovedReviews('company-1', 1, 1);
      expect(page1.total).toBe(2);
      expect(page1.items).toHaveLength(1);
      expect(page1.items[0]).toMatchObject({ processId: 'process-1' });
      expect(page1.items[0].entries).toHaveLength(2);

      const page2 = await service.findApprovedReviews('company-1', 2, 1);
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0]).toMatchObject({ processId: 'process-2' });
    });
  });
});
