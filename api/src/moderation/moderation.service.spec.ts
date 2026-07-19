import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotImplementedException } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewSearchService } from '../search/review-search.service';

describe('ModerationService', () => {
  let service: ModerationService;
  let prisma: {
    moderationQueueEntry: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    roundRating: { update: jest.Mock; findUniqueOrThrow: jest.Mock };
    recruiterRating: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let reviewSearchService: { indexReview: jest.Mock };

  beforeEach(async () => {
    prisma = {
      moderationQueueEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      roundRating: { update: jest.fn(), findUniqueOrThrow: jest.fn() },
      recruiterRating: { update: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    reviewSearchService = { indexReview: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModerationService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReviewSearchService, useValue: reviewSearchService },
      ],
    }).compile();

    service = module.get(ModerationService);
  });

  describe('enqueue', () => {
    it('creates a moderation_queue row for the given entity', async () => {
      prisma.moderationQueueEntry.create.mockResolvedValue({ id: 'queue-1' });

      await service.enqueue('round_rating', 'rating-1');

      expect(prisma.moderationQueueEntry.create).toHaveBeenCalledWith({
        data: { entityType: 'round_rating', entityId: 'rating-1' },
      });
    });

    it('uses the provided transaction client instead of the default one', async () => {
      const tx = { moderationQueueEntry: { create: jest.fn().mockResolvedValue({ id: 'queue-1' }) } };

      await service.enqueue('round_rating', 'rating-1', tx as never);

      expect(tx.moderationQueueEntry.create).toHaveBeenCalled();
      expect(prisma.moderationQueueEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('listPending', () => {
    it('only returns unreviewed entries, oldest first', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([]);

      await service.listPending();

      expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith({
        where: { reviewedAt: null },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('approve / reject / flag', () => {
    function mockPendingRoundRatingEntry() {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'queue-1',
        entityType: 'round_rating',
        entityId: 'rating-1',
        reviewedAt: null,
        flagReason: null,
      });
      prisma.moderationQueueEntry.update.mockImplementation((args: { data: object }) =>
        Promise.resolve({ id: 'queue-1', ...args.data }),
      );
      prisma.roundRating.update.mockResolvedValue({ id: 'rating-1', status: 'approved' });
      prisma.roundRating.findUniqueOrThrow.mockResolvedValue({
        id: 'rating-1',
        freeText: 'Great round',
        createdAt: new Date('2026-01-01'),
        difficulty: 3,
        fairness: 4,
        communicationFluency: 4,
        attentiveness: 4,
        biasSignal: 5,
        round: {
          roundType: 'coding',
          process: { companyId: 'company-1', roleTitle: 'Engineer' },
        },
      });
    }

    it('approve() flips the round rating to approved and stamps the queue entry reviewed', async () => {
      mockPendingRoundRatingEntry();

      const result = await service.approve('queue-1', { reviewedBy: 'gowtham' });

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: { status: 'approved' },
      });
      expect(prisma.moderationQueueEntry.update).toHaveBeenCalledWith({
        where: { id: 'queue-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { reviewedAt: expect.any(Date), reviewedBy: 'gowtham', flagReason: undefined },
      });
      expect(result).toMatchObject({ reviewedBy: 'gowtham' });
    });

    it('approve() indexes the approved review into OpenSearch', async () => {
      mockPendingRoundRatingEntry();

      await service.approve('queue-1', {});

      expect(reviewSearchService.indexReview).toHaveBeenCalledWith({
        id: 'rating-1',
        companyId: 'company-1',
        roleTitle: 'Engineer',
        roundType: 'coding',
        freeText: 'Great round',
        createdAt: new Date('2026-01-01'),
        difficulty: 3,
        fairness: 4,
        communicationFluency: 4,
        attentiveness: 4,
        biasSignal: 5,
      });
    });

    it('approve() still succeeds even if search indexing fails', async () => {
      mockPendingRoundRatingEntry();
      reviewSearchService.indexReview.mockRejectedValue(new Error('OpenSearch unreachable'));

      await expect(service.approve('queue-1', {})).resolves.toBeDefined();
    });

    it('reject() flips the round rating to rejected and does not index it', async () => {
      mockPendingRoundRatingEntry();

      await service.reject('queue-1', {});

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: { status: 'rejected' },
      });
      expect(reviewSearchService.indexReview).not.toHaveBeenCalled();
    });

    it('flag() flips the round rating to flagged, records the flag reason, and does not index it', async () => {
      mockPendingRoundRatingEntry();

      await service.flag('queue-1', { flagReason: 'spam_pattern' });

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: { status: 'flagged' },
      });
      expect(prisma.moderationQueueEntry.update).toHaveBeenCalledWith({
        where: { id: 'queue-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { reviewedAt: expect.any(Date), reviewedBy: undefined, flagReason: 'spam_pattern' },
      });
      expect(reviewSearchService.indexReview).not.toHaveBeenCalled();
    });

    it('throws a conflict if the entry was already reviewed', async () => {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'queue-1',
        entityType: 'round_rating',
        entityId: 'rating-1',
        reviewedAt: new Date(),
      });

      await expect(service.approve('queue-1', {})).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotImplemented for entity types with no write path yet', async () => {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'queue-1',
        entityType: 'overall_review',
        entityId: 'review-1',
        reviewedAt: null,
      });

      await expect(service.approve('queue-1', {})).rejects.toThrow(NotImplementedException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    function mockPendingRecruiterRatingEntry() {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'queue-2',
        entityType: 'recruiter_rating',
        entityId: 'rating-2',
        reviewedAt: null,
        flagReason: null,
      });
      prisma.moderationQueueEntry.update.mockImplementation((args: { data: object }) =>
        Promise.resolve({ id: 'queue-2', ...args.data }),
      );
      prisma.recruiterRating.update.mockResolvedValue({ id: 'rating-2', status: 'approved' });
    }

    it('approve() flips a recruiter rating to approved and does not attempt search indexing', async () => {
      mockPendingRecruiterRatingEntry();

      await service.approve('queue-2', { reviewedBy: 'gowtham' });

      expect(prisma.recruiterRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-2' },
        data: { status: 'approved' },
      });
      expect(reviewSearchService.indexReview).not.toHaveBeenCalled();
    });

    it('reject() flips a recruiter rating to rejected', async () => {
      mockPendingRecruiterRatingEntry();

      await service.reject('queue-2', {});

      expect(prisma.recruiterRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-2' },
        data: { status: 'rejected' },
      });
    });
  });
});
