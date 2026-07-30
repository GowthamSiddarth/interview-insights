import { ReconciliationSweepService, RECONCILIATION_SWEEP_SYSTEM_ACTOR } from './reconciliation-sweep.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiModerationService } from './ai-moderation.service';
import { ModerationService } from '../moderation/moderation.service';

// GitHub issue #442 (Phase 39, D71) — the service is instantiated directly
// (not via the Nest DI container), same pattern as
// ai-moderation.service.spec.ts: no module wiring needed for these tests.
describe('ReconciliationSweepService', () => {
  const originalEnv = { ...process.env };

  let prisma: {
    roundRating: { findMany: jest.Mock; findUnique: jest.Mock };
    recruiterRating: { findMany: jest.Mock; findUnique: jest.Mock };
    overallReview: { findMany: jest.Mock; findUnique: jest.Mock };
    moderationQueueEntry: { findFirst: jest.Mock };
  };
  let aiModerationService: { computeAndStoreVerdict: jest.Mock };
  let moderationService: { flag: jest.Mock };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    prisma = {
      roundRating: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      recruiterRating: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      overallReview: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      moderationQueueEntry: { findFirst: jest.fn() },
    };
    aiModerationService = { computeAndStoreVerdict: jest.fn().mockResolvedValue(undefined) };
    moderationService = { flag: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function buildService(): ReconciliationSweepService {
    return new ReconciliationSweepService(
      prisma as unknown as PrismaService,
      aiModerationService as unknown as AiModerationService,
      moderationService as unknown as ModerationService,
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

  it('re-triages a stale row and does not escalate when the retry produces a verdict', async () => {
    prisma.roundRating.findMany.mockResolvedValue([{ id: 'rating-1' }]);
    prisma.roundRating.findUnique.mockResolvedValue({ moderationVerdict: { concerning: false } });
    const service = buildService();

    await service.sweep();

    expect(aiModerationService.computeAndStoreVerdict).toHaveBeenCalledWith('round_rating', 'rating-1');
    expect(prisma.moderationQueueEntry.findFirst).not.toHaveBeenCalled();
    expect(moderationService.flag).not.toHaveBeenCalled();
  });

  it('escalates to a human-visible flag when the retry still leaves no verdict', async () => {
    prisma.roundRating.findMany.mockResolvedValue([{ id: 'rating-1' }]);
    prisma.roundRating.findUnique.mockResolvedValue({ moderationVerdict: null });
    prisma.moderationQueueEntry.findFirst.mockResolvedValue({ id: 'queue-entry-1' });
    const service = buildService();

    await service.sweep();

    expect(prisma.moderationQueueEntry.findFirst).toHaveBeenCalledWith({
      where: { entityType: 'round_rating', entityId: 'rating-1', reviewedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(moderationService.flag).toHaveBeenCalledWith('queue-entry-1', {
      reviewedBy: RECONCILIATION_SWEEP_SYSTEM_ACTOR,
      flagReason: 'ai_triage_stalled',
    });
  });

  it('does not escalate when the entity is gone by the time the retry finishes', async () => {
    prisma.roundRating.findMany.mockResolvedValue([{ id: 'rating-1' }]);
    prisma.roundRating.findUnique.mockResolvedValue(null);
    const service = buildService();

    await service.sweep();

    expect(prisma.moderationQueueEntry.findFirst).not.toHaveBeenCalled();
    expect(moderationService.flag).not.toHaveBeenCalled();
  });

  it('logs and does not throw when no pending moderation queue entry is found to flag', async () => {
    prisma.roundRating.findMany.mockResolvedValue([{ id: 'rating-1' }]);
    prisma.roundRating.findUnique.mockResolvedValue({ moderationVerdict: null });
    prisma.moderationQueueEntry.findFirst.mockResolvedValue(null);
    const service = buildService();

    await expect(service.sweep()).resolves.toBeUndefined();

    expect(moderationService.flag).not.toHaveBeenCalled();
  });

  it('swallows an error from moderationService.flag() instead of throwing', async () => {
    prisma.roundRating.findMany.mockResolvedValue([{ id: 'rating-1' }]);
    prisma.roundRating.findUnique.mockResolvedValue({ moderationVerdict: null });
    prisma.moderationQueueEntry.findFirst.mockResolvedValue({ id: 'queue-entry-1' });
    moderationService.flag.mockRejectedValue(new Error('already reviewed'));
    const service = buildService();

    await expect(service.sweep()).resolves.toBeUndefined();
  });

  it('processes every stale row returned for an entity type', async () => {
    prisma.recruiterRating.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    prisma.recruiterRating.findUnique
      .mockResolvedValueOnce({ moderationVerdict: { concerning: false } })
      .mockResolvedValueOnce({ moderationVerdict: { concerning: false } });
    const service = buildService();

    await service.sweep();

    expect(aiModerationService.computeAndStoreVerdict).toHaveBeenCalledWith('recruiter_rating', 'r1');
    expect(aiModerationService.computeAndStoreVerdict).toHaveBeenCalledWith('recruiter_rating', 'r2');
  });
});
