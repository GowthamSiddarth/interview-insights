import { Test, TestingModule } from '@nestjs/testing';
import { FraudChecksService } from './fraud-checks.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FraudChecksService', () => {
  let service: FraudChecksService;
  let prisma: {
    interviewProcess: { count: jest.Mock };
    roundRating: { findMany: jest.Mock };
    recruiterRating: { findMany: jest.Mock };
    overallReview: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      interviewProcess: {
        count: jest.fn(),
      },
      roundRating: {
        findMany: jest.fn(),
      },
      recruiterRating: {
        findMany: jest.fn(),
      },
      overallReview: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FraudChecksService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(FraudChecksService);
  });

  // GitHub issue #317 / docs/DECISIONS.md D52: counts InterviewProcess
  // (submission) creations, not individual round/recruiter/overall rows —
  // a single legitimate multi-round submission should never trip this on
  // its own.
  describe('checkRateLimit', () => {
    it('returns true once the candidate hits the submission threshold within the window', async () => {
      prisma.interviewProcess.count.mockResolvedValue(3);

      await expect(service.checkRateLimit('candidate-1')).resolves.toBe(true);
      expect(prisma.interviewProcess.count).toHaveBeenCalledWith({
        where: { candidateId: 'candidate-1', createdAt: { gte: expect.any(Date) as Date } },
      });
    });

    it('returns false below the submission threshold', async () => {
      prisma.interviewProcess.count.mockResolvedValue(2);

      await expect(service.checkRateLimit('candidate-1')).resolves.toBe(false);
    });
  });

  // Scoped per entity type/field (GitHub issue #317): a recruiter rating's
  // freeText is only ever compared against other recruiter ratings'
  // freeText, never cross-type.
  describe('checkDuplicateFreeText', () => {
    it('returns false for empty/whitespace-only text without querying', async () => {
      await expect(service.checkDuplicateFreeText('round_rating', undefined)).resolves.toBe(false);
      await expect(service.checkDuplicateFreeText('round_rating', null)).resolves.toBe(false);
      await expect(service.checkDuplicateFreeText('round_rating', '   ')).resolves.toBe(false);
      expect(prisma.roundRating.findMany).not.toHaveBeenCalled();
    });

    it('matches after normalizing case and whitespace for round_rating', async () => {
      prisma.roundRating.findMany.mockResolvedValue([
        { freeText: '  Great   interview,  fair questions.  ' },
      ]);

      await expect(
        service.checkDuplicateFreeText('round_rating', 'great interview, fair questions.'),
      ).resolves.toBe(true);
      expect(prisma.roundRating.findMany).toHaveBeenCalledWith({
        where: { freeText: { not: null } },
        select: { freeText: true },
      });
    });

    it('matches after normalizing case and whitespace for recruiter_rating', async () => {
      prisma.recruiterRating.findMany.mockResolvedValue([
        { freeText: '  Very   responsive,  clear guidelines.  ' },
      ]);

      await expect(
        service.checkDuplicateFreeText('recruiter_rating', 'very responsive, clear guidelines.'),
      ).resolves.toBe(true);
      expect(prisma.recruiterRating.findMany).toHaveBeenCalledWith({
        where: { freeText: { not: null } },
        select: { freeText: true },
      });
      // Never cross-checked against a different entity type's table.
      expect(prisma.roundRating.findMany).not.toHaveBeenCalled();
    });

    it('matches after normalizing case and whitespace for overall_review', async () => {
      prisma.overallReview.findMany.mockResolvedValue([
        { reviewText: '  Would   recommend,  great loop.  ' },
      ]);

      await expect(
        service.checkDuplicateFreeText('overall_review', 'would recommend, great loop.'),
      ).resolves.toBe(true);
      expect(prisma.overallReview.findMany).toHaveBeenCalledWith({
        where: { reviewText: { not: null } },
        select: { reviewText: true },
      });
    });

    it('returns false when nothing matches', async () => {
      prisma.roundRating.findMany.mockResolvedValue([{ freeText: 'completely different text' }]);

      await expect(service.checkDuplicateFreeText('round_rating', 'unrelated review')).resolves.toBe(
        false,
      );
    });
  });

  describe('detectFlagReason', () => {
    it('prioritizes rate_limit over duplicate when both trip', async () => {
      prisma.interviewProcess.count.mockResolvedValue(5);
      prisma.roundRating.findMany.mockResolvedValue([{ freeText: 'same text' }]);

      await expect(
        service.detectFlagReason('candidate-1', 'round_rating', 'same text'),
      ).resolves.toBe('rate_limit');
    });

    it('returns duplicate when only the duplicate check trips', async () => {
      prisma.interviewProcess.count.mockResolvedValue(0);
      prisma.roundRating.findMany.mockResolvedValue([{ freeText: 'same text' }]);

      await expect(
        service.detectFlagReason('candidate-1', 'round_rating', 'same text'),
      ).resolves.toBe('duplicate');
    });

    it('returns undefined when neither check trips', async () => {
      prisma.interviewProcess.count.mockResolvedValue(0);
      prisma.roundRating.findMany.mockResolvedValue([]);

      await expect(
        service.detectFlagReason('candidate-1', 'round_rating', 'a fresh, unique review'),
      ).resolves.toBeUndefined();
    });

    it('applies the same rate-limit signal regardless of entity type', async () => {
      prisma.interviewProcess.count.mockResolvedValue(3);
      prisma.recruiterRating.findMany.mockResolvedValue([]);
      prisma.overallReview.findMany.mockResolvedValue([]);

      await expect(
        service.detectFlagReason('candidate-1', 'recruiter_rating', undefined),
      ).resolves.toBe('rate_limit');
      await expect(
        service.detectFlagReason('candidate-1', 'overall_review', undefined),
      ).resolves.toBe('rate_limit');
    });
  });
});
