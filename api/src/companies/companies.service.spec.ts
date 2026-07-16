import { Test, TestingModule } from '@nestjs/testing';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { CompanySearchService } from '../search/company-search.service';

describe('CompaniesService', () => {
  let service: CompaniesService;
  let prisma: { company: { create: jest.Mock } };
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
    prisma = { company: { create: jest.fn().mockResolvedValue(createdCompany) } };
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
});
