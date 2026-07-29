import { AiModerationService } from './ai-moderation.service';
import { PrismaService } from '../prisma/prisma.service';

// GitHub issue #163 (Phase 19) — the service is instantiated directly
// (not via the Nest DI container) since @Inject(ANTHROPIC_CLIENT) accepts
// a plain nullable value here; no module wiring needed for these tests.
describe('AiModerationService', () => {
  const originalEnv = { ...process.env };

  let prisma: {
    roundRating: { findUnique: jest.Mock; update: jest.Mock };
    recruiterRating: { findUnique: jest.Mock; update: jest.Mock };
    overallReview: { findUnique: jest.Mock; update: jest.Mock };
  };
  interface RequestParams {
    model: string;
    messages: { content: string }[];
  }
  let anthropicClient: { messages: { create: jest.Mock<Promise<unknown>, [RequestParams]> } };

  function textResponse(body: unknown, stopReason = 'end_turn'): unknown {
    return { stop_reason: stopReason, content: [{ type: 'text', text: JSON.stringify(body) }] };
  }

  beforeEach(() => {
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5';
    prisma = {
      roundRating: { findUnique: jest.fn(), update: jest.fn() },
      recruiterRating: { findUnique: jest.fn(), update: jest.fn() },
      overallReview: { findUnique: jest.fn(), update: jest.fn() },
    };
    anthropicClient = { messages: { create: jest.fn<Promise<unknown>, [RequestParams]>() } };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function buildService(client: unknown = anthropicClient): AiModerationService {
    return new AiModerationService(
      client as never,
      prisma as unknown as PrismaService,
    );
  }

  it('is a no-op when the feature is disabled (no client configured)', async () => {
    const service = buildService(null);

    await service.computeAndStoreVerdict('round_rating', 'rating-1');

    expect(prisma.roundRating.findUnique).not.toHaveBeenCalled();
  });

  it('builds round-rating content from the entity and its round, then stores the parsed verdict', async () => {
    prisma.roundRating.findUnique.mockResolvedValue({
      id: 'rating-1',
      difficulty: 3,
      fluency: 4,
      clarity: 5,
      focus: 4,
      technicalDepth: null,
      freeText: 'Fine round, nothing notable.',
      round: { roundType: 'coding', typeMetadata: { problemAlgorithms: ['DFS'] } },
    });
    anthropicClient.messages.create.mockResolvedValue(
      textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 0.9 }),
    );

    const service = buildService();
    await service.computeAndStoreVerdict('round_rating', 'rating-1');

    expect(prisma.roundRating.findUnique).toHaveBeenCalledWith({
      where: { id: 'rating-1' },
      include: { round: true },
    });
    const call: RequestParams = anthropicClient.messages.create.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-4-5');
    expect(call.messages[0].content).toContain('coding');
    expect(call.messages[0].content).toContain('DFS');
    expect(call.messages[0].content).toContain('Fine round, nothing notable.');

    expect(prisma.roundRating.update).toHaveBeenCalledWith({
      where: { id: 'rating-1' },
      data: {
        moderationVerdict: {
          concerning: false,
          reasons: [],
          summary: 'Looks fine.',
          confidence: 0.9,
          model: 'claude-haiku-4-5',
          analyzedAt: expect.any(String) as string,
          autoApprovalEligible: false,
        },
      },
    });
  });

  describe('auto-approval eligibility routing (GitHub issue #439, D71)', () => {
    function mockCleanRating(): void {
      prisma.roundRating.findUnique.mockResolvedValue({
        id: 'rating-1',
        difficulty: 3,
        fluency: 4,
        clarity: 5,
        focus: 4,
        technicalDepth: null,
        freeText: 'Fine round, nothing notable.',
        round: { roundType: 'coding', typeMetadata: null },
      });
    }

    it('is eligible when clean and confidence meets the configured threshold', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '0.8';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 0.8 }),
      );

      const service = buildService();
      await service.computeAndStoreVerdict('round_rating', 'rating-1');

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: expect.objectContaining({
          moderationVerdict: expect.objectContaining({ autoApprovalEligible: true }) as unknown,
        }) as unknown,
      });
    });

    it('is not eligible when confidence is below the configured threshold', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '0.8';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 0.79 }),
      );

      const service = buildService();
      await service.computeAndStoreVerdict('round_rating', 'rating-1');

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: expect.objectContaining({
          moderationVerdict: expect.objectContaining({ autoApprovalEligible: false }) as unknown,
        }) as unknown,
      });
    });

    it('is never eligible when concerning is true, regardless of confidence', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '0.5';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({
          concerning: true,
          reasons: ['names a specific interviewer'],
          summary: 'Flagged.',
          confidence: 0.99,
        }),
      );

      const service = buildService();
      await service.computeAndStoreVerdict('round_rating', 'rating-1');

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: expect.objectContaining({
          moderationVerdict: expect.objectContaining({ autoApprovalEligible: false }) as unknown,
        }) as unknown,
      });
    });

    it('is never eligible when the threshold env var is unset, even for a clean, high-confidence verdict', async () => {
      delete process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD;
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const service = buildService();
      await service.computeAndStoreVerdict('round_rating', 'rating-1');

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: expect.objectContaining({
          moderationVerdict: expect.objectContaining({ autoApprovalEligible: false }) as unknown,
        }) as unknown,
      });
    });

    it('never stores a verdict when the threshold env var is set but out of range', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '1.5';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const service = buildService();
      await service.computeAndStoreVerdict('round_rating', 'rating-1');

      expect(prisma.roundRating.update).not.toHaveBeenCalled();
    });

    it('never stores a verdict when the threshold env var is set but unparseable', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = 'not-a-number';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const service = buildService();
      await service.computeAndStoreVerdict('round_rating', 'rating-1');

      expect(prisma.roundRating.update).not.toHaveBeenCalled();
    });

    it('is not eligible when the model omits confidence entirely', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '0.5';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.' }),
      );

      const service = buildService();
      await service.computeAndStoreVerdict('round_rating', 'rating-1');

      expect(prisma.roundRating.update).toHaveBeenCalledWith({
        where: { id: 'rating-1' },
        data: expect.objectContaining({
          moderationVerdict: expect.objectContaining({ autoApprovalEligible: false }) as unknown,
        }) as unknown,
      });
    });
  });

  it('builds recruiter-rating content from just the entity itself', async () => {
    prisma.recruiterRating.findUnique.mockResolvedValue({
      id: 'recruiter-rating-1',
      reachability: 4,
      responsiveness: 3,
      guidelinesShared: 5,
      rejectionMessageAuthenticity: null,
      freeText: 'Recruiter was fine.',
    });
    anthropicClient.messages.create.mockResolvedValue(
      textResponse({ concerning: false, reasons: [], summary: 'Fine.' }),
    );

    const service = buildService();
    await service.computeAndStoreVerdict('recruiter_rating', 'recruiter-rating-1');

    const call: RequestParams = anthropicClient.messages.create.mock.calls[0][0];
    expect(call.messages[0].content).toContain('recruiter interaction rating');
    expect(prisma.recruiterRating.update).toHaveBeenCalledWith({
      where: { id: 'recruiter-rating-1' },
      data: expect.objectContaining({
        moderationVerdict: expect.objectContaining({ concerning: false }) as unknown,
      }) as unknown,
    });
  });

  it('builds overall-review content from just the entity itself', async () => {
    prisma.overallReview.findUnique.mockResolvedValue({
      id: 'review-1',
      overallExperience: 5,
      wouldRecommend: true,
      reviewText: 'Great process overall.',
    });
    anthropicClient.messages.create.mockResolvedValue(
      textResponse({ concerning: false, reasons: [], summary: 'Fine.' }),
    );

    const service = buildService();
    await service.computeAndStoreVerdict('overall_review', 'review-1');

    const call: RequestParams = anthropicClient.messages.create.mock.calls[0][0];
    expect(call.messages[0].content).toContain('overall interview process review');
    expect(prisma.overallReview.update).toHaveBeenCalled();
  });

  it('does not call the model at all when the entity no longer exists', async () => {
    prisma.roundRating.findUnique.mockResolvedValue(null);

    const service = buildService();
    await service.computeAndStoreVerdict('round_rating', 'gone');

    expect(anthropicClient.messages.create).not.toHaveBeenCalled();
    expect(prisma.roundRating.update).not.toHaveBeenCalled();
  });

  it('never stores a verdict when the model refuses the request', async () => {
    prisma.roundRating.findUnique.mockResolvedValue({
      id: 'rating-1',
      difficulty: 3,
      fluency: 4,
      clarity: 5,
      focus: 4,
      technicalDepth: null,
      freeText: 'x',
      round: { roundType: 'coding', typeMetadata: null },
    });
    anthropicClient.messages.create.mockResolvedValue(
      textResponse({ concerning: false, reasons: [], summary: 'n/a' }, 'refusal'),
    );

    const service = buildService();
    await service.computeAndStoreVerdict('round_rating', 'rating-1');

    expect(prisma.roundRating.update).not.toHaveBeenCalled();
  });

  it('swallows an unparseable response instead of throwing, and never updates the row', async () => {
    prisma.roundRating.findUnique.mockResolvedValue({
      id: 'rating-1',
      difficulty: 3,
      fluency: 4,
      clarity: 5,
      focus: 4,
      technicalDepth: null,
      freeText: 'x',
      round: { roundType: 'coding', typeMetadata: null },
    });
    anthropicClient.messages.create.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'not valid json' }],
    });

    const service = buildService();
    await expect(
      service.computeAndStoreVerdict('round_rating', 'rating-1'),
    ).resolves.toBeUndefined();

    expect(prisma.roundRating.update).not.toHaveBeenCalled();
  });

  it('swallows a network/API error from the client instead of throwing', async () => {
    prisma.roundRating.findUnique.mockResolvedValue({
      id: 'rating-1',
      difficulty: 3,
      fluency: 4,
      clarity: 5,
      focus: 4,
      technicalDepth: null,
      freeText: 'x',
      round: { roundType: 'coding', typeMetadata: null },
    });
    anthropicClient.messages.create.mockRejectedValue(new Error('network error'));

    const service = buildService();
    await expect(
      service.computeAndStoreVerdict('round_rating', 'rating-1'),
    ).resolves.toBeUndefined();

    expect(prisma.roundRating.update).not.toHaveBeenCalled();
  });

  it('throws from getAnthropicModel (surfaced as a caught, logged failure) when ANTHROPIC_MODEL is unset', async () => {
    delete process.env.ANTHROPIC_MODEL;
    prisma.roundRating.findUnique.mockResolvedValue({
      id: 'rating-1',
      difficulty: 3,
      fluency: 4,
      clarity: 5,
      focus: 4,
      technicalDepth: null,
      freeText: 'x',
      round: { roundType: 'coding', typeMetadata: null },
    });

    const service = buildService();
    await expect(
      service.computeAndStoreVerdict('round_rating', 'rating-1'),
    ).resolves.toBeUndefined();

    expect(anthropicClient.messages.create).not.toHaveBeenCalled();
    expect(prisma.roundRating.update).not.toHaveBeenCalled();
  });
});
