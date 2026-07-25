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

    it('queries approved ratings for the company with pagination applied', async () => {
      await service.findApprovedReviews('company-1', 3, 10);

      expect(prisma.roundRating.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'approved', round: { process: { companyId: 'company-1' } } },
          skip: 20,
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('shapes items for public display without candidateId', async () => {
      prisma.roundRating.count.mockResolvedValue(1);
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
          createdAt: new Date('2026-01-01'),
          round: { title: 'Screen', roundType: 'coding', process: { roleTitle: 'Engineer' } },
        },
      ]);

      const result = await service.findApprovedReviews('company-1', 1, 10);

      expect(result).toMatchObject({ total: 1, page: 1, pageSize: 10 });
      expect(result.items[0]).toMatchObject({
        id: 'rating-1',
        roundTitle: 'Screen',
        roundType: 'coding',
        roleTitle: 'Engineer',
        freeText: 'solid round',
      });
      expect(JSON.stringify(result)).not.toContain('candidate-1');
    });
  });
});
