import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BulkProcessSubmissionService } from './bulk-process-submission.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { FraudChecksService } from '../fraud-checks/fraud-checks.service';
import { RecruitersService } from '../recruiters/recruiters.service';
import { RoundTypeFieldOptionsService } from '../round-type-registry/round-type-field-options.service';
import { CreateBulkProcessDto } from './dto/create-bulk-process.dto';

describe('BulkProcessSubmissionService', () => {
  let service: BulkProcessSubmissionService;
  let prisma: {
    interviewProcess: { create: jest.Mock };
    company: { findUnique: jest.Mock };
    round: { create: jest.Mock };
    roundRating: { create: jest.Mock };
    recruiterInteraction: { create: jest.Mock };
    recruiterRating: { create: jest.Mock };
    overallReview: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let moderationService: { enqueue: jest.Mock; indexForSearch: jest.Mock; publishCreatedEvent: jest.Mock };
  let fraudChecksService: { detectFlagReason: jest.Mock };
  let recruitersService: { findOrCreate: jest.Mock };
  let roundTypeFieldOptionsService: { validateTypeMetadata: jest.Mock };

  const baseDto: CreateBulkProcessDto = {
    roleTitle: 'Senior Backend Engineer',
    outcome: 'in_progress',
  };

  beforeEach(async () => {
    prisma = {
      interviewProcess: { create: jest.fn().mockResolvedValue({ id: 'process-1' }) },
      company: { findUnique: jest.fn().mockResolvedValue({ status: 'approved' }) },
      round: { create: jest.fn().mockResolvedValue({ id: 'round-1' }) },
      roundRating: { create: jest.fn().mockResolvedValue({ id: 'round-rating-1' }) },
      recruiterInteraction: { create: jest.fn().mockResolvedValue({ id: 'interaction-1' }) },
      recruiterRating: { create: jest.fn().mockResolvedValue({ id: 'recruiter-rating-1' }) },
      overallReview: { create: jest.fn().mockResolvedValue({ id: 'review-1' }) },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    moderationService = {
      enqueue: jest.fn(),
      indexForSearch: jest.fn().mockResolvedValue(undefined),
      publishCreatedEvent: jest.fn().mockResolvedValue(undefined),
    };
    fraudChecksService = { detectFlagReason: jest.fn().mockResolvedValue(undefined) };
    recruitersService = { findOrCreate: jest.fn().mockResolvedValue({ id: 'recruiter-1' }) };
    roundTypeFieldOptionsService = { validateTypeMetadata: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkProcessSubmissionService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModerationService, useValue: moderationService },
        { provide: FraudChecksService, useValue: fraudChecksService },
        { provide: RecruitersService, useValue: recruitersService },
        { provide: RoundTypeFieldOptionsService, useValue: roundTypeFieldOptionsService },
      ],
    }).compile();

    service = module.get(BulkProcessSubmissionService);
  });

  it('creates just the process when nothing else is provided', async () => {
    const result = await service.create('company-1', 'candidate-1', baseDto);

    expect(prisma.interviewProcess.create).toHaveBeenCalledWith({
      data: { roleTitle: 'Senior Backend Engineer', outcome: 'in_progress', companyId: 'company-1', candidateId: 'candidate-1' },
    });
    expect(prisma.round.create).not.toHaveBeenCalled();
    expect(prisma.recruiterInteraction.create).not.toHaveBeenCalled();
    expect(prisma.overallReview.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'process-1' });
  });

  // GitHub issue #829 (Phase 57) — an explicit timeout, generously sized
  // beyond Prisma's 5s interactive-transaction default, given this
  // transaction's sequential per-round/per-interaction fraud checks.
  it('passes an explicit, generous timeout to $transaction (GitHub issue #829)', async () => {
    await service.create('company-1', 'candidate-1', baseDto);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20_000 });
  });

  // GitHub issue #369 (Phase 35) — a pending/rejected company doesn't
  // publicly exist yet; nothing in the payload should get created.
  it('rejects with 404 and creates nothing when the company is not approved', async () => {
    prisma.company.findUnique.mockResolvedValue({ status: 'pending' });

    await expect(
      service.create('company-1', 'candidate-1', {
        ...baseDto,
        rounds: [{ sequenceNumber: 1, title: 'Screen', roundType: 'coding' }],
      }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.interviewProcess.create).not.toHaveBeenCalled();
    expect(prisma.round.create).not.toHaveBeenCalled();
  });

  it('creates a round without a rating when none is provided', async () => {
    await service.create('company-1', 'candidate-1', {
      ...baseDto,
      rounds: [{ sequenceNumber: 1, title: 'Technical Screen', roundType: 'coding' }],
    });

    expect(roundTypeFieldOptionsService.validateTypeMetadata).toHaveBeenCalledWith('coding', undefined);
    expect(prisma.round.create).toHaveBeenCalledWith({
      data: {
        sequenceNumber: 1,
        title: 'Technical Screen',
        roundType: 'coding',
        processId: 'process-1',
        typeMetadata: undefined,
      },
    });
    expect(prisma.roundRating.create).not.toHaveBeenCalled();
    expect(moderationService.enqueue).not.toHaveBeenCalled();
  });

  it('creates a round with a rating, runs fraud checks, and enqueues moderation', async () => {
    fraudChecksService.detectFlagReason.mockResolvedValue('rate_limit');

    await service.create('company-1', 'candidate-1', {
      ...baseDto,
      rounds: [
        {
          sequenceNumber: 1,
          title: 'Technical Screen',
          roundType: 'coding',
          rating: { difficulty: 3, fluency: 4, clarity: 4, focus: 4 },
        },
      ],
    });

    expect(fraudChecksService.detectFlagReason).toHaveBeenCalledWith(
      'candidate-1',
      'round_rating',
      undefined,
      prisma,
    );
    expect(prisma.roundRating.create).toHaveBeenCalledWith({
      data: { difficulty: 3, fluency: 4, clarity: 4, focus: 4, roundId: 'round-1', candidateId: 'candidate-1' },
    });
    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'round_rating',
      'round-rating-1',
      prisma,
      'rate_limit',
    );
  });

  it('resolves the recruiter and creates the interaction, without a rating when none is given', async () => {
    await service.create('company-1', 'candidate-1', {
      ...baseDto,
      recruiterInteractions: [{ recruiterIdentifier: 'recruiter@example.com' }],
    });

    expect(recruitersService.findOrCreate).toHaveBeenCalledWith(
      'company-1',
      'recruiter@example.com',
      prisma,
    );
    expect(prisma.recruiterInteraction.create).toHaveBeenCalledWith({
      data: { processId: 'process-1', recruiterId: 'recruiter-1' },
    });
    expect(prisma.recruiterRating.create).not.toHaveBeenCalled();
  });

  it('creates a recruiter rating, runs fraud checks, and enqueues moderation when a rating is given', async () => {
    await service.create('company-1', 'candidate-1', {
      ...baseDto,
      recruiterInteractions: [
        {
          recruiterIdentifier: 'recruiter@example.com',
          rating: { reachability: 4, responsiveness: 4, guidelinesShared: 4 },
        },
      ],
    });

    expect(fraudChecksService.detectFlagReason).toHaveBeenCalledWith(
      'candidate-1',
      'recruiter_rating',
      undefined,
      prisma,
    );
    expect(prisma.recruiterRating.create).toHaveBeenCalledWith({
      data: {
        reachability: 4,
        responsiveness: 4,
        guidelinesShared: 4,
        recruiterInteractionId: 'interaction-1',
        candidateId: 'candidate-1',
      },
    });
    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'recruiter_rating',
      'recruiter-rating-1',
      prisma,
      undefined,
    );
  });

  it('creates the overall review, runs fraud checks, and enqueues moderation when provided', async () => {
    await service.create('company-1', 'candidate-1', {
      ...baseDto,
      overallReview: { overallExperience: 5, wouldRecommend: true },
    });

    expect(fraudChecksService.detectFlagReason).toHaveBeenCalledWith(
      'candidate-1',
      'overall_review',
      undefined,
      prisma,
    );
    expect(prisma.overallReview.create).toHaveBeenCalledWith({
      data: { overallExperience: 5, wouldRecommend: true, processId: 'process-1', candidateId: 'candidate-1' },
    });
    expect(moderationService.enqueue).toHaveBeenCalledWith(
      'overall_review',
      'review-1',
      prisma,
      undefined,
    );
  });

  it('creates every entity type together in one call', async () => {
    await service.create('company-1', 'candidate-1', {
      ...baseDto,
      rounds: [
        {
          sequenceNumber: 1,
          title: 'Technical Screen',
          roundType: 'coding',
          rating: { difficulty: 3, fluency: 4, clarity: 4, focus: 4 },
        },
      ],
      recruiterInteractions: [
        {
          recruiterIdentifier: 'recruiter@example.com',
          rating: { reachability: 4, responsiveness: 4, guidelinesShared: 4 },
        },
      ],
      overallReview: { overallExperience: 5, wouldRecommend: true },
    });

    expect(prisma.round.create).toHaveBeenCalledTimes(1);
    expect(prisma.roundRating.create).toHaveBeenCalledTimes(1);
    expect(prisma.recruiterInteraction.create).toHaveBeenCalledTimes(1);
    expect(prisma.recruiterRating.create).toHaveBeenCalledTimes(1);
    expect(prisma.overallReview.create).toHaveBeenCalledTimes(1);
    expect(moderationService.enqueue).toHaveBeenCalledTimes(3);
  });

  // GitHub issue #332 (Phase 30, D53) — one domain event per rated/reviewed
  // entity created, after the transaction commits (same as indexForSearch).
  // GitHub issue #340/D81 — review-analyzer's own consumer picks these up
  // for LLM triage now; this test used to also assert
  // AiModerationService.computeAndStoreVerdict() was called once per entity.
  it('publishes a created domain event for every rated/reviewed entity created', async () => {
    await service.create('company-1', 'candidate-1', {
      ...baseDto,
      rounds: [
        {
          sequenceNumber: 1,
          title: 'Technical Screen',
          roundType: 'coding',
          rating: { difficulty: 3, fluency: 4, clarity: 4, focus: 4 },
        },
      ],
      recruiterInteractions: [
        {
          recruiterIdentifier: 'recruiter@example.com',
          rating: { reachability: 4, responsiveness: 4, guidelinesShared: 4 },
        },
      ],
      overallReview: { overallExperience: 5, wouldRecommend: true },
    });

    expect(moderationService.publishCreatedEvent).toHaveBeenCalledWith(
      'round_rating',
      'round-rating-1',
    );
    expect(moderationService.publishCreatedEvent).toHaveBeenCalledWith(
      'recruiter_rating',
      'recruiter-rating-1',
    );
    expect(moderationService.publishCreatedEvent).toHaveBeenCalledWith(
      'overall_review',
      'review-1',
    );
    expect(moderationService.publishCreatedEvent).toHaveBeenCalledTimes(3);
  });
});
