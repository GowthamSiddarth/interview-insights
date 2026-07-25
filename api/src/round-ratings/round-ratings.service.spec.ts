import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { RoundRatingsService } from './round-ratings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';
import { ReviewSearchService } from '../search/review-search.service';

describe('RoundRatingsService', () => {
  let service: RoundRatingsService;
  let prisma: {
    roundRating: {
      create: jest.Mock;
      findFirstOrThrow: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let moderationService: { enqueue: jest.Mock; reenqueue: jest.Mock; removeQueueEntries: jest.Mock };
  let fraudChecksService: { detectFlagReason: jest.Mock };
  let reviewSearchService: { removeReview: jest.Mock };

  const dto = {
    difficulty: 3,
    fluency: 5,
    clarity: 4,
    focus: 4,
  };

  beforeEach(async () => {
    prisma = {
      roundRating: {
        create: jest.fn().mockResolvedValue({ id: 'rating-1' }),
        findFirstOrThrow: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    moderationService = {
      enqueue: jest.fn(),
      reenqueue: jest.fn(),
      removeQueueEntries: jest.fn(),
    };
    fraudChecksService = { detectFlagReason: jest.fn().mockResolvedValue(undefined) };
    reviewSearchService = { removeReview: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoundRatingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationService, useValue: moderationService },
        { provide: FraudChecksService, useValue: fraudChecksService },
        { provide: ReviewSearchService, useValue: reviewSearchService },
      ],
    }).compile();

    service = module.get(RoundRatingsService);
  });

  it('checks pre-existing rows for fraud signals before creating the rating', async () => {
    await service.create('round-1', 'candidate-1', dto);

    expect(fraudChecksService.detectFlagReason).toHaveBeenCalledWith(
      'candidate-1',
      'round_rating',
      undefined,
      prisma,
    );
    expect(prisma.roundRating.create).toHaveBeenCalled();
  });

  it('attributes the rating to the given candidateId, not anything from the dto', async () => {
    await service.create('round-1', 'candidate-1', dto);

    expect(prisma.roundRating.create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() is typed `any` by @types/jest
      data: expect.objectContaining({ candidateId: 'candidate-1', roundId: 'round-1' }),
    });
  });

  it('passes the detected flagReason through to the moderation queue entry', async () => {
    fraudChecksService.detectFlagReason.mockResolvedValue('rate_limit');

    await service.create('round-1', 'candidate-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'round_rating',
      'rating-1',
      prisma,
      'rate_limit',
    );
  });

  it('enqueues with no flagReason when nothing is flagged', async () => {
    await service.create('round-1', 'candidate-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'round_rating',
      'rating-1',
      prisma,
      undefined,
    );
  });

  describe('update', () => {
    it('resets the rating to pending and re-enqueues it for moderation', async () => {
      prisma.roundRating.findFirstOrThrow.mockResolvedValue({
        id: 'rating-1',
        roundId: 'round-1',
        candidateId: 'candidate-1',
        status: 'approved',
      });
      prisma.roundRating.update.mockResolvedValue({ id: 'rating-1', status: 'pending' });

      await service.update('round-1', 'rating-1', 'candidate-1', dto);

      expect(prisma.roundRating.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: 'rating-1', roundId: 'round-1' },
      });
      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: { ...dto, status: 'pending' },
      });
      expect(moderationService.reenqueue).toHaveBeenCalledWith('round_rating', 'rating-1', prisma);
    });

    it('rejects an edit from anyone but the owning candidate', async () => {
      prisma.roundRating.findFirstOrThrow.mockResolvedValue({
        id: 'rating-1',
        roundId: 'round-1',
        candidateId: 'candidate-1',
        status: 'pending',
      });

      await expect(service.update('round-1', 'rating-1', 'candidate-2', dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the rating and its moderation_queue entries', async () => {
      prisma.roundRating.findFirstOrThrow.mockResolvedValue({
        id: 'rating-1',
        roundId: 'round-1',
        candidateId: 'candidate-1',
        status: 'pending',
      });

      await service.remove('round-1', 'rating-1', 'candidate-1');

      expect(moderationService.removeQueueEntries).toHaveBeenCalledWith(
        'round_rating',
        'rating-1',
        prisma,
      );
      expect(prisma.roundRating.delete).toHaveBeenCalledWith({ where: { id: 'rating-1' } });
      expect(reviewSearchService.removeReview).not.toHaveBeenCalled();
    });

    it('best-effort removes an approved rating from the search index too', async () => {
      prisma.roundRating.findFirstOrThrow.mockResolvedValue({
        id: 'rating-1',
        roundId: 'round-1',
        candidateId: 'candidate-1',
        status: 'approved',
      });

      await service.remove('round-1', 'rating-1', 'candidate-1');

      expect(reviewSearchService.removeReview).toHaveBeenCalledWith('rating-1');
    });

    it('rejects a delete from anyone but the owning candidate', async () => {
      prisma.roundRating.findFirstOrThrow.mockResolvedValue({
        id: 'rating-1',
        roundId: 'round-1',
        candidateId: 'candidate-1',
        status: 'pending',
      });

      await expect(service.remove('round-1', 'rating-1', 'candidate-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
