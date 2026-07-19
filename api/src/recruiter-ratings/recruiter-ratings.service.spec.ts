import { Test, TestingModule } from '@nestjs/testing';
import { RecruiterRatingsService } from './recruiter-ratings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';

describe('RecruiterRatingsService', () => {
  let service: RecruiterRatingsService;
  let prisma: {
    recruiterRating: { create: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let moderationService: { enqueue: jest.Mock };

  const dto = {
    candidateId: 'candidate-1',
    approachability: 4,
    responseTime: 3,
    timeliness: 5,
    communicationQuality: 4,
  };

  beforeEach(async () => {
    prisma = {
      recruiterRating: {
        create: jest.fn().mockResolvedValue({ id: 'rating-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    moderationService = { enqueue: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecruiterRatingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationService, useValue: moderationService },
      ],
    }).compile();

    service = module.get(RecruiterRatingsService);
  });

  it('creates the rating scoped to the given recruiter interaction', async () => {
    await service.create('interaction-1', dto);

    expect(prisma.recruiterRating.create).toHaveBeenCalledWith({
      data: { ...dto, recruiterInteractionId: 'interaction-1' },
    });
  });

  it('enqueues the new rating for moderation', async () => {
    await service.create('interaction-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith('recruiter_rating', 'rating-1', prisma);
  });

  it('findApprovedForInteraction only queries approved ratings for that interaction', async () => {
    await service.findApprovedForInteraction('interaction-1');

    expect(prisma.recruiterRating.findMany).toHaveBeenCalledWith({
      where: { recruiterInteractionId: 'interaction-1', status: 'approved' },
      orderBy: { createdAt: 'desc' },
    });
  });
});
