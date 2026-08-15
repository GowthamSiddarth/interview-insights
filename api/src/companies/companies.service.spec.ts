import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';

describe('CompaniesService', () => {
  let service: CompaniesService;
  let prisma: {
    company: {
      create: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      findFirstOrThrow: jest.Mock;
      findMany: jest.Mock;
    };
    roundRating: { count: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let moderationService: {
    enqueue: jest.Mock;
    reenqueue: jest.Mock;
    indexForSearch: jest.Mock;
    publishCreatedEvent: jest.Mock;
  };

  const dto = { name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' as const };
  const createdCompany = {
    id: 'company-1',
    name: 'Acme Corp',
    slug: 'acme-corp',
    industry: null,
    sizeBucket: 'mid',
    logoUrl: null,
    status: 'pending',
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      company: {
        create: jest.fn().mockResolvedValue(createdCompany),
        update: jest.fn().mockResolvedValue({ ...createdCompany, status: 'pending' }),
        findFirst: jest.fn().mockResolvedValue(null),
        findFirstOrThrow: jest.fn().mockResolvedValue(createdCompany),
        findMany: jest.fn().mockResolvedValue([]),
      },
      roundRating: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    moderationService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      reenqueue: jest.fn().mockResolvedValue({ id: 'queue-2' }),
      indexForSearch: jest.fn().mockResolvedValue(undefined),
      publishCreatedEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationService, useValue: moderationService },
      ],
    }).compile();

    service = module.get(CompaniesService);
  });

  // GitHub issue #369 (Phase 35) — company creation moves behind
  // moderation: the row is created (status defaults to pending) and
  // enqueued, never indexed to OpenSearch directly.
  describe('create', () => {
    it('creates the company, attributed to the given candidate, and enqueues it for moderation', async () => {
      const result = await service.create(dto, 'candidate-1');

      expect(prisma.company.create).toHaveBeenCalledWith({
        data: { ...dto, candidateId: 'candidate-1' },
      });
      expect(moderationService.enqueue).toHaveBeenCalledWith('company', createdCompany.id);
      expect(result).toEqual(createdCompany);
    });

    // GitHub issue #698 (Phase 50, D104).
    it('publishes a created domain event after creating the company', async () => {
      await service.create(dto, 'candidate-1');

      expect(moderationService.publishCreatedEvent).toHaveBeenCalledWith('company', createdCompany.id);
    });

    // GitHub issue #696 (Phase 50, D104) — seed-demo-data.ts creates
    // companies before any candidate exists in its own generation loop;
    // candidateId is optional for exactly that "no requester" case.
    it('creates the company with no candidateId when none is given', async () => {
      await service.create(dto);

      expect(prisma.company.create).toHaveBeenCalledWith({
        data: { ...dto, candidateId: undefined },
      });
    });

    it('checks for an existing pending duplicate by slug first', async () => {
      await service.create(dto, 'candidate-1');

      expect(prisma.company.findFirst).toHaveBeenCalledWith({
        where: { slug: dto.slug, status: 'pending' },
      });
    });

    it('rejects with a friendly message when a pending duplicate already exists', async () => {
      prisma.company.findFirst.mockResolvedValue({ ...createdCompany, status: 'pending' });

      await expect(service.create(dto, 'candidate-1')).rejects.toThrow(ConflictException);
      await expect(service.create(dto, 'candidate-1')).rejects.toThrow(
        /already been requested and is pending review/,
      );
      expect(prisma.company.create).not.toHaveBeenCalled();
    });

    // GitHub issue #696 (Phase 50, D104) — findFirst() is now scoped to
    // status: 'pending' directly (an approved or rejected duplicate is
    // never returned by the query at all), so both cases fall straight
    // through to create() without needing a second existing-row check.
    it('falls through to a normal create attempt when no pending duplicate exists (approved or rejected slug reuse)', async () => {
      prisma.company.findFirst.mockResolvedValue(null);

      await service.create(dto, 'candidate-1');

      expect(prisma.company.create).toHaveBeenCalled();
    });
  });

  // GitHub issue #697 (Phase 50, D104).
  describe('update', () => {
    it('resets a pending company to pending (no-op status-wise) and re-enqueues it for moderation', async () => {
      prisma.company.findFirstOrThrow.mockResolvedValue({ ...createdCompany, candidateId: 'candidate-1', status: 'pending' });

      const result = await service.update('company-1', 'candidate-1', dto);

      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { ...dto, status: 'pending' },
      });
      expect(moderationService.reenqueue).toHaveBeenCalledWith('company', 'company-1', prisma);
      expect(result).toEqual({ ...createdCompany, status: 'pending' });
    });

    it('resets a rejected company to pending and re-enqueues it, letting a resubmission through', async () => {
      prisma.company.findFirstOrThrow.mockResolvedValue({ ...createdCompany, candidateId: 'candidate-1', status: 'rejected' });

      await service.update('company-1', 'candidate-1', dto);

      expect(prisma.company.update).toHaveBeenCalledWith({
        where: { id: 'company-1' },
        data: { ...dto, status: 'pending' },
      });
    });

    it('rejects an edit from anyone but the owning candidate', async () => {
      prisma.company.findFirstOrThrow.mockResolvedValue({ ...createdCompany, candidateId: 'candidate-1', status: 'pending' });

      await expect(service.update('company-1', 'candidate-2', dto)).rejects.toThrow(ForbiddenException);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });

    it('rejects an edit attempt on a company with no requester at all (seed/admin-created)', async () => {
      prisma.company.findFirstOrThrow.mockResolvedValue({ ...createdCompany, candidateId: null, status: 'pending' });

      await expect(service.update('company-1', 'candidate-1', dto)).rejects.toThrow(ForbiddenException);
    });

    it('rejects editing an approved company, even by its own requester', async () => {
      prisma.company.findFirstOrThrow.mockResolvedValue({ ...createdCompany, candidateId: 'candidate-1', status: 'approved' });

      await expect(service.update('company-1', 'candidate-1', dto)).rejects.toThrow(ForbiddenException);
      expect(prisma.company.update).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('only lists approved companies', async () => {
      await service.findAll();

      expect(prisma.company.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'approved' } }),
      );
    });
  });

  describe('findTop', () => {
    const approvedCompanies = Array.from({ length: 8 }, (_, i) => ({
      ...createdCompany,
      id: `company-${i}`,
      slug: `company-${i}`,
    }));

    it('only queries approved companies', async () => {
      prisma.company.findMany.mockResolvedValue(approvedCompanies);

      await service.findTop();

      expect(prisma.company.findMany).toHaveBeenCalledWith({ where: { status: 'approved' } });
    });

    it('caps the result at 5, even with more approved companies available', async () => {
      prisma.company.findMany.mockResolvedValue(approvedCompanies);

      const result = await service.findTop();

      expect(result).toHaveLength(5);
    });

    it('returns every approved company when there are 5 or fewer', async () => {
      const fewer = approvedCompanies.slice(0, 3);
      prisma.company.findMany.mockResolvedValue(fewer);

      const result = await service.findTop();

      expect(result).toHaveLength(3);
      expect(result.map((c) => c.id).sort()).toEqual(fewer.map((c) => c.id).sort());
    });

    it('returns an empty list when there are no approved companies', async () => {
      prisma.company.findMany.mockResolvedValue([]);

      const result = await service.findTop();

      expect(result).toEqual([]);
    });
  });

  describe('findBySlug', () => {
    it('looks the company up by its unique slug, approved only', async () => {
      await service.findBySlug('acme-corp');

      expect(prisma.company.findFirstOrThrow).toHaveBeenCalledWith({
        where: { slug: 'acme-corp', status: 'approved' },
      });
    });
  });

  describe('findApprovedReviews', () => {
    it('verifies the company exists and is approved before querying (404 rather than an empty page)', async () => {
      await service.findApprovedReviews('company-1', 1, 10);

      expect(prisma.company.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: 'company-1', status: 'approved' },
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
