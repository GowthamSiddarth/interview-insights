import { Test, TestingModule } from '@nestjs/testing';
import { FraudChecksService } from './fraud-checks.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FraudChecksService', () => {
  let service: FraudChecksService;
  let prisma: { roundRating: { count: jest.Mock; findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      roundRating: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [FraudChecksService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(FraudChecksService);
  });

  describe('checkRateLimit', () => {
    it('returns true once the candidate hits the threshold within the window', async () => {
      prisma.roundRating.count.mockResolvedValue(3);

      await expect(service.checkRateLimit('candidate-1')).resolves.toBe(true);
      expect(prisma.roundRating.count).toHaveBeenCalledWith({
        where: { candidateId: 'candidate-1', createdAt: { gte: expect.any(Date) as Date } },
      });
    });

    it('returns false below the threshold', async () => {
      prisma.roundRating.count.mockResolvedValue(2);

      await expect(service.checkRateLimit('candidate-1')).resolves.toBe(false);
    });
  });

  describe('checkDuplicateFreeText', () => {
    it('returns false for empty/whitespace-only text without querying', async () => {
      await expect(service.checkDuplicateFreeText(undefined)).resolves.toBe(false);
      await expect(service.checkDuplicateFreeText(null)).resolves.toBe(false);
      await expect(service.checkDuplicateFreeText('   ')).resolves.toBe(false);
      expect(prisma.roundRating.findMany).not.toHaveBeenCalled();
    });

    it('matches after normalizing case and whitespace', async () => {
      prisma.roundRating.findMany.mockResolvedValue([
        { freeText: '  Great   interview,  fair questions.  ' },
      ]);

      await expect(
        service.checkDuplicateFreeText('great interview, fair questions.'),
      ).resolves.toBe(true);
    });

    it('returns false when nothing matches', async () => {
      prisma.roundRating.findMany.mockResolvedValue([{ freeText: 'completely different text' }]);

      await expect(service.checkDuplicateFreeText('unrelated review')).resolves.toBe(false);
    });
  });

  describe('detectFlagReason', () => {
    it('prioritizes rate_limit over duplicate when both trip', async () => {
      prisma.roundRating.count.mockResolvedValue(5);
      prisma.roundRating.findMany.mockResolvedValue([{ freeText: 'same text' }]);

      await expect(service.detectFlagReason('candidate-1', 'same text')).resolves.toBe(
        'rate_limit',
      );
    });

    it('returns duplicate when only the duplicate check trips', async () => {
      prisma.roundRating.count.mockResolvedValue(0);
      prisma.roundRating.findMany.mockResolvedValue([{ freeText: 'same text' }]);

      await expect(service.detectFlagReason('candidate-1', 'same text')).resolves.toBe(
        'duplicate',
      );
    });

    it('returns undefined when neither check trips', async () => {
      prisma.roundRating.count.mockResolvedValue(0);
      prisma.roundRating.findMany.mockResolvedValue([]);

      await expect(
        service.detectFlagReason('candidate-1', 'a fresh, unique review'),
      ).resolves.toBeUndefined();
    });
  });
});
