import { Test, TestingModule } from '@nestjs/testing';
import { RoundRatingsService } from './round-ratings.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';

describe('RoundRatingsService', () => {
  let service: RoundRatingsService;
  let prisma: { roundRating: { create: jest.Mock }; $transaction: jest.Mock };
  let moderationService: { enqueue: jest.Mock };
  let fraudChecksService: { detectFlagReason: jest.Mock };

  const dto = {
    candidateId: 'candidate-1',
    difficulty: 3,
    fairness: 4,
    communicationFluency: 5,
    attentiveness: 4,
    biasSignal: 5,
  };

  beforeEach(async () => {
    prisma = {
      roundRating: { create: jest.fn().mockResolvedValue({ id: 'rating-1' }) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    moderationService = { enqueue: jest.fn() };
    fraudChecksService = { detectFlagReason: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoundRatingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationService, useValue: moderationService },
        { provide: FraudChecksService, useValue: fraudChecksService },
      ],
    }).compile();

    service = module.get(RoundRatingsService);
  });

  it('checks pre-existing rows for fraud signals before creating the rating', async () => {
    await service.create('round-1', dto);

    expect(fraudChecksService.detectFlagReason).toHaveBeenCalledWith(
      'candidate-1',
      undefined,
      prisma,
    );
    expect(prisma.roundRating.create).toHaveBeenCalled();
  });

  it('passes the detected flagReason through to the moderation queue entry', async () => {
    fraudChecksService.detectFlagReason.mockResolvedValue('rate_limit');

    await service.create('round-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'round_rating',
      'rating-1',
      prisma,
      'rate_limit',
    );
  });

  it('enqueues with no flagReason when nothing is flagged', async () => {
    await service.create('round-1', dto);

    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'round_rating',
      'rating-1',
      prisma,
      undefined,
    );
  });
});
