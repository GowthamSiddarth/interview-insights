import { ReconciliationSweepService } from './reconciliation-sweep.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnalysisService } from './analysis.service';
import { VerdictPublisher } from '../events/verdict-publisher.service';

// Ported from api/src/ai-moderation/reconciliation-sweep.service.spec.ts
// (GitHub issue #340/#442, D81) — this version publishes a verdict_computed
// event (normal, or `stalled: true` on a still-unresolved retry) instead of
// calling ModerationService.flag() directly, since this service never
// touches moderation_queue. The "no pending queue entry"/"flag() throws"
// cases from the original live in api's own verdict-consumer.service.spec.ts
// now — that's the side that actually calls flag().
describe('ReconciliationSweepService', () => {
  const originalEnv = { ...process.env };

  let prisma: {
    roundRating: { findMany: jest.Mock; findUnique: jest.Mock };
    recruiterRating: { findMany: jest.Mock; findUnique: jest.Mock };
    overallReview: { findMany: jest.Mock; findUnique: jest.Mock };
  };
  let analysisService: { computeVerdict: jest.Mock };
  let verdictPublisher: { publish: jest.Mock };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    prisma = {
      roundRating: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      recruiterRating: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      overallReview: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
    };
    analysisService = { computeVerdict: jest.fn().mockResolvedValue(null) };
    verdictPublisher = { publish: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function buildService(): ReconciliationSweepService {
    return new ReconciliationSweepService(
      prisma as unknown as PrismaService,
      analysisService as unknown as AnalysisService,
      verdictPublisher as unknown as VerdictPublisher,
    );
  }

  it('is a no-op when AI moderation is disabled (no ANTHROPIC_API_KEY)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const service = buildService();

    await service.sweep();

    expect(prisma.roundRating.findMany).not.toHaveBeenCalled();
    expect(prisma.recruiterRating.findMany).not.toHaveBeenCalled();
    expect(prisma.overallReview.findMany).not.toHaveBeenCalled();
  });

  it('sweeps all three triageable entity types', async () => {
    const service = buildService();

    await service.sweep();

    expect(prisma.roundRating.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'pending' }) as unknown,
      select: { id: true },
    });
    expect(prisma.recruiterRating.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'pending' }) as unknown,
      select: { id: true },
    });
    expect(prisma.overallReview.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'pending' }) as unknown,
      select: { id: true },
    });
  });

  it('re-triages a stale row and publishes a normal verdict_computed event when the retry succeeds', async () => {
    prisma.roundRating.findMany.mockResolvedValue([{ id: 'rating-1' }]);
    analysisService.computeVerdict.mockResolvedValue({
      verdict: { concerning: false },
      promptContent: 'p',
      responseText: 'r',
      confidence: 0.9,
      model: 'claude-haiku-4-5',
    });
    const service = buildService();

    await service.sweep();

    expect(analysisService.computeVerdict).toHaveBeenCalledWith('round_rating', 'rating-1');
    expect(prisma.roundRating.findUnique).not.toHaveBeenCalled();
    expect(verdictPublisher.publish).toHaveBeenCalledWith(
      expect.stringContaining('verdict_computed'),
      expect.objectContaining({ roundRatingId: 'rating-1', verdict: { concerning: false } }) as unknown,
      'rating-1',
    );
  });

  it('publishes a stalled escalation event when the retry still leaves no verdict', async () => {
    prisma.roundRating.findMany.mockResolvedValue([{ id: 'rating-1' }]);
    analysisService.computeVerdict.mockResolvedValue(null);
    prisma.roundRating.findUnique.mockResolvedValue({ id: 'rating-1' });
    const service = buildService();

    await service.sweep();

    expect(prisma.roundRating.findUnique).toHaveBeenCalledWith({
      where: { id: 'rating-1' },
      select: { id: true },
    });
    expect(verdictPublisher.publish).toHaveBeenCalledWith(
      expect.stringContaining('verdict_computed'),
      expect.objectContaining({ roundRatingId: 'rating-1', stalled: true, verdict: null }) as unknown,
      'rating-1',
    );
  });

  it('does not publish anything when the entity is gone by the time the retry finishes', async () => {
    prisma.roundRating.findMany.mockResolvedValue([{ id: 'rating-1' }]);
    analysisService.computeVerdict.mockResolvedValue(null);
    prisma.roundRating.findUnique.mockResolvedValue(null);
    const service = buildService();

    await service.sweep();

    expect(verdictPublisher.publish).not.toHaveBeenCalled();
  });

  it('processes every stale row returned for an entity type', async () => {
    prisma.recruiterRating.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    analysisService.computeVerdict.mockResolvedValue({
      verdict: { concerning: false },
      promptContent: 'p',
      responseText: 'r',
      confidence: 0.9,
      model: 'claude-haiku-4-5',
    });
    const service = buildService();

    await service.sweep();

    expect(analysisService.computeVerdict).toHaveBeenCalledWith('recruiter_rating', 'r1');
    expect(analysisService.computeVerdict).toHaveBeenCalledWith('recruiter_rating', 'r2');
  });
});
