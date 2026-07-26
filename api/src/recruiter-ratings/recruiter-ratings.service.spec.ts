import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { RecruiterRatingsService } from './recruiter-ratings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';

describe('RecruiterRatingsService', () => {
  let service: RecruiterRatingsService;
  let prisma: {
    recruiterRating: {
      create: jest.Mock;
      findMany: jest.Mock;
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
    reachability: 4,
    responsiveness: 3,
    guidelinesShared: 5,
  };

  beforeEach(async () => {
    prisma = {
      recruiterRating: {
        create: jest.fn().mockResolvedValue({ id: 'rating-1' }),
        findMany: jest.fn().mockResolvedValue([]),
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
        RecruiterRatingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationService, useValue: moderationService },
        { provide: FraudChecksService, useValue: fraudChecksService },
      ],
    }).compile();

    service = module.get(RecruiterRatingsService);
  });

  it('creates the rating scoped to the given recruiter interaction and candidate', async () => {
    await service.create('interaction-1', 'candidate-1', dto);

    expect(prisma.recruiterRating.create).toHaveBeenCalledWith({
      data: { ...dto, recruiterInteractionId: 'interaction-1', candidateId: 'candidate-1' },
    });
  });

  // GitHub issue #317 (D52): fraud-check wiring, same shape as
  // RoundRatingsService.create().
  it('checks pre-existing rows for fraud signals before creating the rating', async () => {
    await service.create('interaction-1', 'candidate-1', dto);

    expect(fraudChecksService.detectFlagReason).toHaveBeenCalledWith(
      'candidate-1',
      'recruiter_rating',
      undefined,
      prisma,
    );
  });

  it('enqueues the new rating for moderation with no flagReason when nothing is flagged', async () => {
    await service.create('interaction-1', 'candidate-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'recruiter_rating',
      'rating-1',
      prisma,
      undefined,
    );
  });

  it('passes the detected flagReason through to the moderation queue entry', async () => {
    fraudChecksService.detectFlagReason.mockResolvedValue('rate_limit');

    await service.create('interaction-1', 'candidate-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'recruiter_rating',
      'rating-1',
      prisma,
      'rate_limit',
    );
  });

  it('findApprovedForInteraction only queries approved ratings for that interaction', async () => {
    await service.findApprovedForInteraction('interaction-1');

    expect(prisma.recruiterRating.findMany).toHaveBeenCalledWith({
      where: { recruiterInteractionId: 'interaction-1', status: 'approved' },
      orderBy: { createdAt: 'desc' },
    });
  });

  describe('update', () => {
    it('resets the rating to pending and re-enqueues it for moderation', async () => {
      prisma.recruiterRating.findFirstOrThrow.mockResolvedValue({
        id: 'rating-1',
        recruiterInteractionId: 'interaction-1',
        candidateId: 'candidate-1',
        status: 'approved',
      });
      prisma.recruiterRating.update.mockResolvedValue({ id: 'rating-1', status: 'pending' });

      await service.update('interaction-1', 'rating-1', 'candidate-1', dto);

      expect(prisma.recruiterRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: { ...dto, status: 'pending' },
      });
      expect(moderationService.reenqueue).toHaveBeenCalledWith(
        'recruiter_rating',
        'rating-1',
        prisma,
      );
    });

    it('rejects an edit from anyone but the owning candidate', async () => {
      prisma.recruiterRating.findFirstOrThrow.mockResolvedValue({
        id: 'rating-1',
        recruiterInteractionId: 'interaction-1',
        candidateId: 'candidate-1',
        status: 'pending',
      });

      await expect(
        service.update('interaction-1', 'rating-1', 'candidate-2', dto),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the rating and its moderation_queue entries', async () => {
      prisma.recruiterRating.findFirstOrThrow.mockResolvedValue({
        id: 'rating-1',
        recruiterInteractionId: 'interaction-1',
        candidateId: 'candidate-1',
        status: 'pending',
      });

      await service.remove('interaction-1', 'rating-1', 'candidate-1');

      expect(moderationService.removeQueueEntries).toHaveBeenCalledWith(
        'recruiter_rating',
        'rating-1',
        prisma,
      );
      expect(prisma.recruiterRating.delete).toHaveBeenCalledWith({ where: { id: 'rating-1' } });
    });

    it('rejects a delete from anyone but the owning candidate', async () => {
      prisma.recruiterRating.findFirstOrThrow.mockResolvedValue({
        id: 'rating-1',
        recruiterInteractionId: 'interaction-1',
        candidateId: 'candidate-1',
        status: 'pending',
      });

      await expect(service.remove('interaction-1', 'rating-1', 'candidate-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
