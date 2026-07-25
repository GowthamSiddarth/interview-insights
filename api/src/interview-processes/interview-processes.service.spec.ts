import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { InterviewProcessesService } from './interview-processes.service';
import { PrismaService } from '../prisma/prisma.service';

describe('InterviewProcessesService', () => {
  let service: InterviewProcessesService;
  let prisma: {
    interviewProcess: { findUniqueOrThrow: jest.Mock; delete: jest.Mock };
    round: { deleteMany: jest.Mock };
    recruiterInteraction: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const emptyProcess = {
    id: 'process-1',
    candidateId: 'candidate-1',
    rounds: [],
    recruiterInteractions: [],
    overallReview: null,
  };

  beforeEach(async () => {
    prisma = {
      interviewProcess: {
        findUniqueOrThrow: jest.fn(),
        delete: jest.fn(),
      },
      round: { deleteMany: jest.fn() },
      recruiterInteraction: { deleteMany: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [InterviewProcessesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(InterviewProcessesService);
  });

  describe('remove', () => {
    it('deletes a genuinely empty process, its rounds, and its recruiter interactions', async () => {
      prisma.interviewProcess.findUniqueOrThrow.mockResolvedValue(emptyProcess);

      await service.remove('process-1', 'candidate-1');

      expect(prisma.round.deleteMany).toHaveBeenCalledWith({ where: { processId: 'process-1' } });
      expect(prisma.recruiterInteraction.deleteMany).toHaveBeenCalledWith({
        where: { processId: 'process-1' },
      });
      expect(prisma.interviewProcess.delete).toHaveBeenCalledWith({ where: { id: 'process-1' } });
    });

    it('rejects a delete from anyone but the owning candidate', async () => {
      prisma.interviewProcess.findUniqueOrThrow.mockResolvedValue(emptyProcess);

      await expect(service.remove('process-1', 'candidate-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['a round rating in any status', { ...emptyProcess, rounds: [{ ratings: [{ status: 'pending' }] }] }],
      [
        'a recruiter rating',
        { ...emptyProcess, recruiterInteractions: [{ ratings: [{ status: 'rejected' }] }] },
      ],
      ['an overall review', { ...emptyProcess, overallReview: { id: 'review-1' } }],
    ])('rejects deleting a process that has %s', async (_desc, processWithContent) => {
      prisma.interviewProcess.findUniqueOrThrow.mockResolvedValue(processWithContent);

      await expect(service.remove('process-1', 'candidate-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
