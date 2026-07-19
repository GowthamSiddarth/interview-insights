import { Test, TestingModule } from '@nestjs/testing';
import { OverallReviewsService } from './overall-reviews.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';

describe('OverallReviewsService', () => {
  let service: OverallReviewsService;
  let prisma: {
    overallReview: { create: jest.Mock; findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let moderationService: { enqueue: jest.Mock };

  const dto = {
    candidateId: 'candidate-1',
    overallExperience: 4,
    wouldRecommend: true,
  };

  beforeEach(async () => {
    prisma = {
      overallReview: {
        create: jest.fn().mockResolvedValue({ id: 'review-1' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    moderationService = { enqueue: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OverallReviewsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationService, useValue: moderationService },
      ],
    }).compile();

    service = module.get(OverallReviewsService);
  });

  it('creates the review scoped to the given process', async () => {
    await service.create('process-1', dto);

    expect(prisma.overallReview.create).toHaveBeenCalledWith({
      data: { ...dto, processId: 'process-1' },
    });
  });

  it('enqueues the new review for moderation', async () => {
    await service.create('process-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith('overall_review', 'review-1', prisma);
  });

  it('findApprovedForProcess only queries the approved review for that process', async () => {
    await service.findApprovedForProcess('process-1');

    expect(prisma.overallReview.findFirst).toHaveBeenCalledWith({
      where: { processId: 'process-1', status: 'approved' },
    });
  });
});
