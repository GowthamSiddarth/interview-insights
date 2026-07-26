import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { OverallReviewsService } from './overall-reviews.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';

describe('OverallReviewsService', () => {
  let service: OverallReviewsService;
  let prisma: {
    overallReview: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findFirstOrThrow: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let moderationService: {
    enqueue: jest.Mock;
    reenqueue: jest.Mock;
    removeQueueEntries: jest.Mock;
    indexForSearch: jest.Mock;
    removeFromSearchIndex: jest.Mock;
  };
  let fraudChecksService: { detectFlagReason: jest.Mock };

  const dto = {
    overallExperience: 4,
    wouldRecommend: true,
  };

  beforeEach(async () => {
    prisma = {
      overallReview: {
        create: jest.fn().mockResolvedValue({ id: 'review-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
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
      indexForSearch: jest.fn().mockResolvedValue(undefined),
      removeFromSearchIndex: jest.fn().mockResolvedValue(undefined),
    };
    fraudChecksService = { detectFlagReason: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverallReviewsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationService, useValue: moderationService },
        { provide: FraudChecksService, useValue: fraudChecksService },
      ],
    }).compile();

    service = module.get(OverallReviewsService);
  });

  it('creates the review scoped to the given process and candidate', async () => {
    await service.create('process-1', 'candidate-1', dto);

    expect(prisma.overallReview.create).toHaveBeenCalledWith({
      data: { ...dto, processId: 'process-1', candidateId: 'candidate-1' },
    });
  });

  // GitHub issue #317 (D52): fraud-check wiring, same shape as
  // RoundRatingsService.create().
  it('checks pre-existing rows for fraud signals before creating the review', async () => {
    await service.create('process-1', 'candidate-1', dto);

    expect(fraudChecksService.detectFlagReason).toHaveBeenCalledWith(
      'candidate-1',
      'overall_review',
      undefined,
      prisma,
    );
  });

  it('enqueues the new review for moderation with no flagReason when nothing is flagged', async () => {
    await service.create('process-1', 'candidate-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'overall_review',
      'review-1',
      prisma,
      undefined,
    );
  });

  it('passes the detected flagReason through to the moderation queue entry', async () => {
    fraudChecksService.detectFlagReason.mockResolvedValue('rate_limit');

    await service.create('process-1', 'candidate-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'overall_review',
      'review-1',
      prisma,
      'rate_limit',
    );
  });

  it('findApprovedForProcess only queries the approved review for that process', async () => {
    await service.findApprovedForProcess('process-1');

    expect(prisma.overallReview.findFirst).toHaveBeenCalledWith({
      where: { processId: 'process-1', status: 'approved' },
    });
  });

  describe('update', () => {
    it('resets the review to pending and re-enqueues it for moderation', async () => {
      prisma.overallReview.findFirstOrThrow.mockResolvedValue({
        id: 'review-1',
        processId: 'process-1',
        candidateId: 'candidate-1',
        status: 'approved',
      });
      prisma.overallReview.update.mockResolvedValue({ id: 'review-1', status: 'pending' });

      await service.update('process-1', 'candidate-1', dto);

      expect(prisma.overallReview.update).toHaveBeenCalledWith({
        where: { processId: 'process-1' },
        data: { ...dto, status: 'pending' },
      });
      expect(moderationService.reenqueue).toHaveBeenCalledWith('overall_review', 'review-1', prisma);
    });

    it('rejects an edit from anyone but the owning candidate', async () => {
      prisma.overallReview.findFirstOrThrow.mockResolvedValue({
        id: 'review-1',
        processId: 'process-1',
        candidateId: 'candidate-1',
        status: 'pending',
      });

      await expect(service.update('process-1', 'candidate-2', dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the review and its moderation_queue entries', async () => {
      prisma.overallReview.findFirstOrThrow.mockResolvedValue({
        id: 'review-1',
        processId: 'process-1',
        candidateId: 'candidate-1',
        status: 'pending',
      });

      await service.remove('process-1', 'candidate-1');

      expect(moderationService.removeQueueEntries).toHaveBeenCalledWith(
        'overall_review',
        'review-1',
        prisma,
      );
      expect(prisma.overallReview.delete).toHaveBeenCalledWith({ where: { processId: 'process-1' } });
    });

    it('rejects a delete from anyone but the owning candidate', async () => {
      prisma.overallReview.findFirstOrThrow.mockResolvedValue({
        id: 'review-1',
        processId: 'process-1',
        candidateId: 'candidate-1',
        status: 'pending',
      });

      await expect(service.remove('process-1', 'candidate-2')).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
