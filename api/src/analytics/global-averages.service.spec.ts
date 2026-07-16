import { Test, TestingModule } from '@nestjs/testing';
import { GlobalAveragesService } from './global-averages.service';
import { PrismaService } from '../prisma/prisma.service';

describe('GlobalAveragesService', () => {
  let service: GlobalAveragesService;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [GlobalAveragesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(GlobalAveragesService);
  });

  describe('getRoundTypeGlobalAverages', () => {
    it('parses numeric strings into numbers when data exists', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          avg_difficulty: '3.50',
          avg_fairness: '4.00',
          avg_communication_fluency: '4.20',
          avg_attentiveness: '3.80',
          avg_bias_signal: '4.10',
          sample_size: 42,
        },
      ]);

      const result = await service.getRoundTypeGlobalAverages('coding');

      expect(result).toEqual({
        avgDifficulty: 3.5,
        avgFairness: 4.0,
        avgCommunicationFluency: 4.2,
        avgAttentiveness: 3.8,
        avgBiasSignal: 4.1,
        sampleSize: 42,
      });
    });

    it('returns null when there is no platform data for that round type yet', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          avg_difficulty: null,
          avg_fairness: null,
          avg_communication_fluency: null,
          avg_attentiveness: null,
          avg_bias_signal: null,
          sample_size: null,
        },
      ]);

      await expect(service.getRoundTypeGlobalAverages('coding')).resolves.toBeNull();
    });

    it('returns null when the query returns no rows at all', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      await expect(service.getRoundTypeGlobalAverages('coding')).resolves.toBeNull();
    });
  });

  describe('getRecruiterGlobalAverages', () => {
    it('parses numeric strings into numbers when data exists', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          avg_approachability: '4.50',
          avg_response_time: '3.90',
          avg_timeliness: '4.10',
          avg_communication_quality: '4.00',
          sample_size: 10,
        },
      ]);

      await expect(service.getRecruiterGlobalAverages()).resolves.toEqual({
        avgApproachability: 4.5,
        avgResponseTime: 3.9,
        avgTimeliness: 4.1,
        avgCommunicationQuality: 4.0,
        sampleSize: 10,
      });
    });

    it('returns null when there is no platform data yet', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          avg_approachability: null,
          avg_response_time: null,
          avg_timeliness: null,
          avg_communication_quality: null,
          sample_size: 0,
        },
      ]);

      await expect(service.getRecruiterGlobalAverages()).resolves.toBeNull();
    });
  });

  describe('getOverallGlobalAverages', () => {
    it('parses numeric strings into numbers when data exists', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { avg_overall_experience: '4.25', pct_would_recommend: '78.50', sample_size: 20 },
      ]);

      await expect(service.getOverallGlobalAverages()).resolves.toEqual({
        avgOverallExperience: 4.25,
        pctWouldRecommend: 78.5,
        sampleSize: 20,
      });
    });

    it('returns null when there is no platform data yet', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { avg_overall_experience: null, pct_would_recommend: null, sample_size: null },
      ]);

      await expect(service.getOverallGlobalAverages()).resolves.toBeNull();
    });
  });
});
