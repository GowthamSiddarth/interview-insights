import { Test, TestingModule } from '@nestjs/testing';
import { RecruiterInteractionsService } from './recruiter-interactions.service';
import { PrismaService } from '../prisma/prisma.service';
import { RecruitersService } from '../recruiters/recruiters.service';

describe('RecruiterInteractionsService', () => {
  let service: RecruiterInteractionsService;
  let prisma: {
    interviewProcess: { findUniqueOrThrow: jest.Mock };
    recruiterInteraction: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let recruitersService: { findOrCreate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      interviewProcess: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ companyId: 'company-1' }),
      },
      recruiterInteraction: {
        create: jest.fn().mockResolvedValue({ id: 'interaction-1' }),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    recruitersService = { findOrCreate: jest.fn().mockResolvedValue({ id: 'recruiter-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecruiterInteractionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RecruitersService, useValue: recruitersService },
      ],
    }).compile();

    service = module.get(RecruiterInteractionsService);
  });

  it('resolves the recruiter via the process company before creating the interaction', async () => {
    await service.create('process-1', { recruiterIdentifier: 'jane@example.com' });

    expect(prisma.interviewProcess.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'process-1' },
      select: { companyId: true },
    });
    expect(recruitersService.findOrCreate).toHaveBeenCalledWith(
      'company-1',
      'jane@example.com',
      prisma,
    );
  });

  it('creates the interaction against the resolved recruiter and process', async () => {
    const result = await service.create('process-1', { recruiterIdentifier: 'jane@example.com' });

    expect(prisma.recruiterInteraction.create).toHaveBeenCalledWith({
      data: { processId: 'process-1', recruiterId: 'recruiter-1' },
    });
    expect(result).toEqual({ id: 'interaction-1' });
  });
});