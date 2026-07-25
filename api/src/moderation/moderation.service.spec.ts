import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
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
      deleteMany: jest.Mock;
    };
    roundRating: { update: jest.Mock; findUniqueOrThrow: jest.Mock; findMany: jest.Mock };
    recruiterRating: { update: jest.Mock; findMany: jest.Mock };
    overallReview: { update: jest.Mock; findMany: jest.Mock };
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
        deleteMany: jest.fn(),
      },
      roundRating: {
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      recruiterRating: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      overallReview: { update: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
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

  describe('reenqueue', () => {
    it('deletes any still-unreviewed entry for the entity before creating a fresh one', async () => {
      prisma.moderationQueueEntry.deleteMany.mockResolvedValue({ count: 1 });
      prisma.moderationQueueEntry.create.mockResolvedValue({ id: 'queue-2' });

      await service.reenqueue('round_rating', 'rating-1');

      expect(prisma.moderationQueueEntry.deleteMany).toHaveBeenCalledWith({
        where: { entityType: 'round_rating', entityId: 'rating-1', reviewedAt: null },
      });
      expect(prisma.moderationQueueEntry.create).toHaveBeenCalledWith({
        data: { entityType: 'round_rating', entityId: 'rating-1' },
      });
    });

    it('uses the provided transaction client instead of the default one', async () => {
      const tx = {
        moderationQueueEntry: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({ id: 'queue-2' }),
        },
      };

      await service.reenqueue('round_rating', 'rating-1', tx as never);

      expect(tx.moderationQueueEntry.deleteMany).toHaveBeenCalled();
      expect(tx.moderationQueueEntry.create).toHaveBeenCalled();
      expect(prisma.moderationQueueEntry.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('removeQueueEntries', () => {
    it('deletes every entry for the entity, reviewed or not', async () => {
      prisma.moderationQueueEntry.deleteMany.mockResolvedValue({ count: 1 });

      await service.removeQueueEntries('round_rating', 'rating-1');

      expect(prisma.moderationQueueEntry.deleteMany).toHaveBeenCalledWith({
        where: { entityType: 'round_rating', entityId: 'rating-1' },
      });
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

    it('enriches each entry with its entity, using only generated labels — never the identifier hash', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'round_rating', entityId: 'rr1', reviewedAt: null },
        { id: 'q2', entityType: 'recruiter_rating', entityId: 'cr1', reviewedAt: null },
        { id: 'q3', entityType: 'overall_review', entityId: 'ov1', reviewedAt: null },
      ]);
      prisma.roundRating.findMany.mockResolvedValue([
        {
          id: 'rr1',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: 'tough but fair',
          round: {
            title: 'Screen',
            roundType: 'coding',
            process: { roleTitle: 'Engineer', company: { name: 'Acme' } },
          },
        },
      ]);
      prisma.recruiterRating.findMany.mockResolvedValue([
        {
          id: 'cr1',
          reachability: 5,
          responsiveness: 4,
          guidelinesShared: 5,
          rejectionMessageAuthenticity: null,
          freeText: null,
          recruiterInteraction: {
            recruiter: { displayLabel: 'Recruiter A', internalIdentifierHash: 'deadbeef' },
            process: { roleTitle: 'Engineer', company: { name: 'Acme' } },
          },
        },
      ]);
      prisma.overallReview.findMany.mockResolvedValue([
        {
          id: 'ov1',
          overallExperience: 4,
          wouldRecommend: true,
          reviewText: 'good loop',
          process: { roleTitle: 'Engineer', company: { name: 'Acme' } },
        },
      ]);

      const result = await service.listPending();

      expect(result[0].entity).toMatchObject({
        companyName: 'Acme',
        roundTitle: 'Screen',
        difficulty: 3,
        freeText: 'tough but fair',
      });
      expect(result[1].entity).toMatchObject({
        recruiterLabel: 'Recruiter A',
        reachability: 5,
      });
      expect(JSON.stringify(result)).not.toContain('deadbeef');
      expect(result[2].entity).toMatchObject({
        overallExperience: 4,
        wouldRecommend: true,
      });
    });

    it('attaches entity: null when the underlying row is missing', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'round_rating', entityId: 'gone', reviewedAt: null },
      ]);

      const result = await service.listPending();

      expect(result[0].entity).toBeNull();
    });

    // GitHub issue #212 / docs/DECISIONS.md D37: a required-relation
    // include (e.g. recruiterRating -> recruiterInteraction -> process)
    // can transiently reject if Prisma splits the nested include across
    // multiple round trips and a concurrent delete (GDPR erasure, #151;
    // Update/Delete, #150) commits in between — one entity type's
    // enrichment failing must never crash the other two, or the whole
    // endpoint.
    it('degrades one entity type to entity: null on a transient enrichment failure, without affecting the other two', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'q1', entityType: 'round_rating', entityId: 'rr1', reviewedAt: null },
        { id: 'q2', entityType: 'recruiter_rating', entityId: 'cr1', reviewedAt: null },
        { id: 'q3', entityType: 'overall_review', entityId: 'ov1', reviewedAt: null },
      ]);
      prisma.roundRating.findMany.mockResolvedValue([
        {
          id: 'rr1',
          difficulty: 3,
          fluency: 4,
          clarity: 4,
          focus: 4,
          technicalDepth: null,
          freeText: null,
          round: { title: 'Screen', roundType: 'coding', process: { roleTitle: 'Engineer', company: { name: 'Acme' } } },
        },
      ]);
      prisma.recruiterRating.findMany.mockRejectedValue(
        new Error('Inconsistent query result: Field process is required to return data, got `null` instead.'),
      );
      prisma.overallReview.findMany.mockResolvedValue([
        {
          id: 'ov1',
          overallExperience: 4,
          wouldRecommend: true,
          reviewText: 'good loop',
          process: { roleTitle: 'Engineer', company: { name: 'Acme' } },
        },
      ]);

      const result = await service.listPending();

      expect(result[0].entity).toMatchObject({ roundTitle: 'Screen' });
      expect(result[1].entity).toBeNull();
      expect(result[2].entity).toMatchObject({ overallExperience: 4 });
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
        fluency: 4,
        clarity: 4,
        focus: 4,
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
        fluency: 4,
        clarity: 4,
        focus: 4,
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

    function mockPendingOverallReviewEntry() {
      prisma.moderationQueueEntry.findUniqueOrThrow.mockResolvedValue({
        id: 'queue-3',
        entityType: 'overall_review',
        entityId: 'review-1',
        reviewedAt: null,
        flagReason: null,
      });
      prisma.moderationQueueEntry.update.mockImplementation((args: { data: object }) =>
        Promise.resolve({ id: 'queue-3', ...args.data }),
      );
      prisma.overallReview.update.mockResolvedValue({ id: 'review-1', status: 'approved' });
    }

    it('approve() flips an overall review to approved and does not attempt search indexing', async () => {
      mockPendingOverallReviewEntry();

      await service.approve('queue-3', { reviewedBy: 'gowtham' });

      expect(prisma.overallReview.update).toHaveBeenCalledWith({
        where: { id: 'review-1' },
        data: { status: 'approved' },
      });
      expect(reviewSearchService.indexReview).not.toHaveBeenCalled();
    });

    it('reject() flips an overall review to rejected', async () => {
      mockPendingOverallReviewEntry();

      await service.reject('queue-3', {});

      expect(prisma.overallReview.update).toHaveBeenCalledWith({
        where: { id: 'review-1' },
        data: { status: 'rejected' },
      });
    });
  });
});
