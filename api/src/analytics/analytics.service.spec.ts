import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { GlobalAveragesService } from './global-averages.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: { company: { findUniqueOrThrow: jest.Mock }; $queryRaw: jest.Mock };
  let globalAveragesService: {
    getRoundTypeGlobalAverages: jest.Mock;
    getRecruiterGlobalAverages: jest.Mock;
    getOverallGlobalAverages: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      company: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'company-1' }) },
      $queryRaw: jest.fn(),
    };
    globalAveragesService = {
      getRoundTypeGlobalAverages: jest.fn(),
      getRecruiterGlobalAverages: jest.fn(),
      getOverallGlobalAverages: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: GlobalAveragesService, useValue: globalAveragesService },
      ],
    }).compile();

    service = module.get(AnalyticsService);
  });

  it('propagates a not-found company lookup rather than swallowing it', async () => {
    prisma.company.findUniqueOrThrow.mockRejectedValue(new Error('P2025'));

    await expect(service.getCompanyAnalytics('missing-company')).rejects.toThrow('P2025');
  });

  it('shrinkage-scores each round type using its own global averages, and returns null with recruiter/overall when neither exists', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          round_type: 'coding',
          avg_difficulty: '4.00',
          avg_fairness: '4.00',
          avg_communication_fluency: '4.00',
          avg_attentiveness: '4.00',
          avg_bias_signal: '4.00',
          sample_size: 10,
        },
      ])
      .mockResolvedValueOnce([]) // recruiter rows
      .mockResolvedValueOnce([]); // overall rows
    globalAveragesService.getRoundTypeGlobalAverages.mockResolvedValue({
      avgDifficulty: 2.0,
      avgFairness: 2.0,
      avgCommunicationFluency: 2.0,
      avgAttentiveness: 2.0,
      avgBiasSignal: 2.0,
      sampleSize: 100,
    });

    const result = await service.getCompanyAnalytics('company-1');

    expect(globalAveragesService.getRoundTypeGlobalAverages).toHaveBeenCalledWith('coding');
    expect(result.roundTypes).toHaveLength(1);
    expect(result.roundTypes[0].sampleSize).toBe(10);
    // (10/(10+8))*4 + (8/(10+8))*2 = (10*4 + 8*2)/18 = 56/18 ≈ 3.111
    expect(result.roundTypes[0].scores.difficulty).toBeCloseTo(3.1111, 3);
    expect(result.recruiter).toBeNull();
    expect(result.overall).toBeNull();
  });

  it('returns null scores (but a real sample_size) for a round type under the shrinkage floor', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          round_type: 'behavioral',
          avg_difficulty: '5.00',
          avg_fairness: '5.00',
          avg_communication_fluency: '5.00',
          avg_attentiveness: '5.00',
          avg_bias_signal: '5.00',
          sample_size: 2,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    globalAveragesService.getRoundTypeGlobalAverages.mockResolvedValue({
      avgDifficulty: 3.0,
      avgFairness: 3.0,
      avgCommunicationFluency: 3.0,
      avgAttentiveness: 3.0,
      avgBiasSignal: 3.0,
      sampleSize: 50,
    });

    const result = await service.getCompanyAnalytics('company-1');

    expect(result.roundTypes[0].sampleSize).toBe(2);
    expect(result.roundTypes[0].scores).toEqual({
      difficulty: null,
      fairness: null,
      communicationFluency: null,
      attentiveness: null,
      biasSignal: null,
    });
  });

  it('builds recruiter and overall analytics when rows exist for the company', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // round type rows
      .mockResolvedValueOnce([
        {
          avg_approachability: '4.50',
          avg_response_time: '4.00',
          avg_timeliness: '4.00',
          avg_communication_quality: '4.00',
          sample_size: 5,
        },
      ])
      .mockResolvedValueOnce([
        { avg_overall_experience: '4.20', pct_would_recommend: '80.00', sample_size: 6 },
      ]);
    globalAveragesService.getRecruiterGlobalAverages.mockResolvedValue({
      avgApproachability: 3.0,
      avgResponseTime: 3.0,
      avgTimeliness: 3.0,
      avgCommunicationQuality: 3.0,
      sampleSize: 40,
    });
    globalAveragesService.getOverallGlobalAverages.mockResolvedValue({
      avgOverallExperience: 3.0,
      pctWouldRecommend: 60.0,
      sampleSize: 40,
    });

    const result = await service.getCompanyAnalytics('company-1');

    expect(result.roundTypes).toEqual([]);
    expect(result.recruiter).not.toBeNull();
    expect(result.recruiter!.sampleSize).toBe(5);
    expect(result.recruiter!.scores.approachability).not.toBeNull();
    expect(result.overall).not.toBeNull();
    expect(result.overall!.sampleSize).toBe(6);
    expect(result.overall!.scores.wouldRecommendPct).not.toBeNull();
  });

  it('returns null for a metric when there is no platform-wide data at all (defensive — normally unreachable since the company itself contributes)', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          round_type: 'coding',
          avg_difficulty: '4.00',
          avg_fairness: '4.00',
          avg_communication_fluency: '4.00',
          avg_attentiveness: '4.00',
          avg_bias_signal: '4.00',
          sample_size: 10,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    globalAveragesService.getRoundTypeGlobalAverages.mockResolvedValue(null);

    const result = await service.getCompanyAnalytics('company-1');

    expect(result.roundTypes[0].scores).toEqual({
      difficulty: null,
      fairness: null,
      communicationFluency: null,
      attentiveness: null,
      biasSignal: null,
    });
  });
});
