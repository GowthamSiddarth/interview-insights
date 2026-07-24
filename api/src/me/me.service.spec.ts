import { Test, TestingModule } from '@nestjs/testing';
import { MeService } from './me.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MeService', () => {
  let service: MeService;
  let prisma: { interviewProcess: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { interviewProcess: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MeService, { provide: PrismaService, useValue: prisma }],
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
                fairness: 4,
                communicationFluency: 4,
                attentiveness: 4,
                biasSignal: 5,
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
                approachability: 5,
                responseTime: 4,
                timeliness: 5,
                communicationQuality: 5,
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
            fairness: 4,
            communicationFluency: 4,
            attentiveness: 4,
            biasSignal: 5,
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
            approachability: 5,
            responseTime: 4,
            timeliness: 5,
            communicationQuality: 5,
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
});
