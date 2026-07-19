import { Test, TestingModule } from '@nestjs/testing';
import { RecruitersService } from './recruiters.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RecruitersService', () => {
  let service: RecruitersService;
  let prisma: {
    recruiter: { findUnique: jest.Mock; count: jest.Mock; create: jest.Mock };
  };

  beforeEach(async () => {
    process.env.EMAIL_HASH_SECRET = 'test-secret';
    prisma = {
      recruiter: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RecruitersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(RecruitersService);
  });

  it('returns the existing recruiter when the hashed identifier already matches one for the company', async () => {
    prisma.recruiter.findUnique.mockResolvedValue({ id: 'recruiter-1' });

    const result = await service.findOrCreate('company-1', 'jane@example.com');

    expect(result).toEqual({ id: 'recruiter-1' });
    expect(prisma.recruiter.create).not.toHaveBeenCalled();
  });

  it('creates a new recruiter with a generated label when no match exists', async () => {
    prisma.recruiter.findUnique.mockResolvedValue(null);
    prisma.recruiter.count.mockResolvedValue(0);
    prisma.recruiter.create.mockResolvedValue({ id: 'recruiter-2', displayLabel: 'Recruiter A' });

    const result = await service.findOrCreate('company-1', 'jane@example.com');

    expect(prisma.recruiter.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'company-1', displayLabel: 'Recruiter A' }) as unknown,
    });
    expect(result).toEqual({ id: 'recruiter-2', displayLabel: 'Recruiter A' });
  });

  it('labels the Nth new recruiter for a company with the Nth letter', async () => {
    prisma.recruiter.findUnique.mockResolvedValue(null);
    prisma.recruiter.count.mockResolvedValue(2);
    prisma.recruiter.create.mockResolvedValue({ id: 'recruiter-3', displayLabel: 'Recruiter C' });

    await service.findOrCreate('company-1', 'third@example.com');

    expect(prisma.recruiter.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ displayLabel: 'Recruiter C' }) as unknown,
    });
  });

  it('never stores the raw identifier, only its hash', async () => {
    prisma.recruiter.findUnique.mockResolvedValue(null);
    prisma.recruiter.count.mockResolvedValue(0);
    prisma.recruiter.create.mockResolvedValue({ id: 'recruiter-1' });

    await service.findOrCreate('company-1', 'jane@example.com');

    expect(prisma.recruiter.create).toHaveBeenCalled();
    const [createArgs] = prisma.recruiter.create.mock.calls[0] as [
      { data: { internalIdentifierHash: string } },
    ];
    expect(createArgs.data.internalIdentifierHash).not.toContain('jane');
    expect(createArgs.data.internalIdentifierHash).toMatch(/^[0-9a-f]{64}$/);
  });
});