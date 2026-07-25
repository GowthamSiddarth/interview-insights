import { Test, TestingModule } from '@nestjs/testing';
import { MeService } from './me.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewSearchService } from '../search/review-search.service';

describe('MeService', () => {
  let service: MeService;
  let prisma: {
    interviewProcess: { findMany: jest.Mock; deleteMany: jest.Mock };
    roundRating: { findMany: jest.Mock; deleteMany: jest.Mock };
    recruiterRating: { findMany: jest.Mock; deleteMany: jest.Mock };
    overallReview: { findMany: jest.Mock; deleteMany: jest.Mock };
    round: { deleteMany: jest.Mock };
    recruiterInteraction: { deleteMany: jest.Mock };
    candidateVerificationToken: { deleteMany: jest.Mock };
    candidate: { delete: jest.Mock };
    moderationQueueEntry: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let reviewSearchService: { removeReview: jest.Mock };

  beforeEach(async () => {
    prisma = {
      interviewProcess: { findMany: jest.fn(), deleteMany: jest.fn() },
      roundRating: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      recruiterRating: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      overallReview: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      round: { deleteMany: jest.fn() },
      recruiterInteraction: { deleteMany: jest.fn() },
      candidateVerificationToken: { deleteMany: jest.fn() },
      candidate: { delete: jest.fn() },
      moderationQueueEntry: { deleteMany: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    reviewSearchService = { removeReview: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeService,
        { provide: PrismaService, useValue: prisma },
        { provide: ReviewSearchService, useValue: reviewSearchService },
      ],
    }).compile();

    service = module.get(MeService);
  });

  it('scopes the query to the given candidateId only', async () => {
    prisma.interviewProcess.findMany.mockResolvedValue([]);

    await service.findMySubmissions('candidate-1');

    expect(prisma.interviewProcess.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { candidateId: 'candidate-1' },
      }) as unknown,
    );
  });

  it('groups a process with its nested round ratings, recruiter ratings, and overall review', async () => {
    prisma.interviewProcess.findMany.mockResolvedValue([
      {
        id: 'process-1',
        companyId: 'company-1',
        company: { name: 'Acme Corp', slug: 'acme-corp' },
        roleTitle: 'Senior Engineer',
        outcome: 'in_progress',
        createdAt: new Date('2026-01-01'),
        rounds: [
          {
            id: 'round-1',
            title: 'Technical Screen',
            roundType: 'coding',
            ratings: [
              {
                id: 'rating-1',
                status: 'pending',
                difficulty: 3,
                fluency: 4,
                clarity: 4,
                focus: 4,
                technicalDepth: null,
                freeText: null,
                createdAt: new Date('2026-01-02'),
              },
            ],
          },
          {
            id: 'round-2',
            title: 'Behavioral',
            roundType: 'behavioral',
            ratings: [],
          },
        ],
        recruiterInteractions: [
          {
            id: 'interaction-1',
            ratings: [
              {
                id: 'recruiter-rating-1',
                status: 'approved',
                reachability: 5,
                responsiveness: 4,
                guidelinesShared: 5,
                rejectionMessageAuthenticity: null,
                freeText: null,
                createdAt: new Date('2026-01-03'),
              },
            ],
          },
        ],
        overallReview: {
          id: 'overall-1',
          status: 'rejected',
          overallExperience: 2,
          wouldRecommend: false,
          reviewText: 'Not great',
          createdAt: new Date('2026-01-04'),
        },
      },
    ]);

    const result = await service.findMySubmissions('candidate-1');

    expect(result).toEqual([
      {
        processId: 'process-1',
        companyId: 'company-1',
        companyName: 'Acme Corp',
        companySlug: 'acme-corp',
        roleTitle: 'Senior Engineer',
        outcome: 'in_progress',
        createdAt: new Date('2026-01-01'),
        roundRatings: [
          {
            id: 'rating-1',
            roundId: 'round-1',
            roundTitle: 'Technical Screen',
            roundType: 'coding',
            status: 'pending',
            difficulty: 3,
            fluency: 4,
            clarity: 4,
            focus: 4,
            technicalDepth: null,
            freeText: null,
            createdAt: new Date('2026-01-02'),
          },
        ],
        recruiterRatings: [
          {
            id: 'recruiter-rating-1',
            recruiterInteractionId: 'interaction-1',
            status: 'approved',
            reachability: 5,
            responsiveness: 4,
            guidelinesShared: 5,
            rejectionMessageAuthenticity: null,
            freeText: null,
            createdAt: new Date('2026-01-03'),
          },
        ],
        overallReview: {
          id: 'overall-1',
          status: 'rejected',
          overallExperience: 2,
          wouldRecommend: false,
          reviewText: 'Not great',
          createdAt: new Date('2026-01-04'),
        },
      },
    ]);
  });

  it('omits a round from roundRatings entirely when it has no rating yet', async () => {
    prisma.interviewProcess.findMany.mockResolvedValue([
      {
        id: 'process-1',
        companyId: 'company-1',
        company: { name: 'Acme Corp', slug: 'acme-corp' },
        roleTitle: 'Engineer',
        outcome: 'in_progress',
        createdAt: new Date('2026-01-01'),
        rounds: [{ id: 'round-1', title: 'Screen', roundType: 'coding', ratings: [] }],
        recruiterInteractions: [],
        overallReview: null,
      },
    ]);

    const result = await service.findMySubmissions('candidate-1');

    expect(result[0].roundRatings).toEqual([]);
    expect(result[0].recruiterRatings).toEqual([]);
    expect(result[0].overallReview).toBeNull();
  });

  it('returns an empty array when the candidate has no processes', async () => {
    prisma.interviewProcess.findMany.mockResolvedValue([]);

    const result = await service.findMySubmissions('candidate-1');

    expect(result).toEqual([]);
  });

  describe('eraseMe', () => {
    beforeEach(() => {
      prisma.roundRating.findMany.mockResolvedValue([
        { id: 'rating-1', status: 'approved' },
        { id: 'rating-2', status: 'pending' },
      ]);
      prisma.recruiterRating.findMany.mockResolvedValue([{ id: 'recruiter-rating-1' }]);
      prisma.overallReview.findMany.mockResolvedValue([{ id: 'review-1' }]);
      prisma.interviewProcess.findMany.mockResolvedValue([{ id: 'process-1' }, { id: 'process-2' }]);
    });

    it('deletes moderation_queue entries for every gathered entity id, by type', async () => {
      await service.eraseMe('candidate-1');

      expect(prisma.moderationQueueEntry.deleteMany).toHaveBeenCalledWith({
        where: { entityType: 'round_rating', entityId: { in: ['rating-1', 'rating-2'] } },
      });
      expect(prisma.moderationQueueEntry.deleteMany).toHaveBeenCalledWith({
        where: { entityType: 'recruiter_rating', entityId: { in: ['recruiter-rating-1'] } },
      });
      expect(prisma.moderationQueueEntry.deleteMany).toHaveBeenCalledWith({
        where: { entityType: 'overall_review', entityId: { in: ['review-1'] } },
      });
    });

    it('deletes ratings/reviews, structural entities scoped to this candidate, tokens, then the candidate row', async () => {
      await service.eraseMe('candidate-1');

      expect(prisma.roundRating.deleteMany).toHaveBeenCalledWith({ where: { candidateId: 'candidate-1' } });
      expect(prisma.recruiterRating.deleteMany).toHaveBeenCalledWith({
        where: { candidateId: 'candidate-1' },
      });
      expect(prisma.overallReview.deleteMany).toHaveBeenCalledWith({
        where: { candidateId: 'candidate-1' },
      });
      expect(prisma.round.deleteMany).toHaveBeenCalledWith({
        where: { processId: { in: ['process-1', 'process-2'] } },
      });
      expect(prisma.recruiterInteraction.deleteMany).toHaveBeenCalledWith({
        where: { processId: { in: ['process-1', 'process-2'] } },
      });
      expect(prisma.interviewProcess.deleteMany).toHaveBeenCalledWith({
        where: { candidateId: 'candidate-1' },
      });
      expect(prisma.candidateVerificationToken.deleteMany).toHaveBeenCalledWith({
        where: { candidateId: 'candidate-1' },
      });
      expect(prisma.candidate.delete).toHaveBeenCalledWith({ where: { id: 'candidate-1' } });
    });

    it('never touches the shared Recruiter row', async () => {
      // The mocked tx/prisma has no `recruiter` model at all — if
      // eraseMe() ever called tx.recruiter.anything(), this would throw
      // a TypeError instead of resolving. Deleting the candidate's own
      // RecruiterInteraction rows must never cascade to the shared
      // Recruiter row other candidates may still reference.
      await expect(service.eraseMe('candidate-1')).resolves.toBeUndefined();
    });

    it('best-effort removes only the approved round ratings from the search index', async () => {
      await service.eraseMe('candidate-1');

      expect(reviewSearchService.removeReview).toHaveBeenCalledTimes(1);
      expect(reviewSearchService.removeReview).toHaveBeenCalledWith('rating-1');
    });

    it('does not attempt search removal for any pending/rejected/flagged rating', async () => {
      prisma.roundRating.findMany.mockResolvedValue([{ id: 'rating-2', status: 'pending' }]);

      await service.eraseMe('candidate-1');

      expect(reviewSearchService.removeReview).not.toHaveBeenCalled();
    });
  });
});
