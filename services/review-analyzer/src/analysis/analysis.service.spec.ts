import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AnalysisService } from './analysis.service';
import { PrismaService } from '../prisma/prisma.service';

// Ported from api/src/ai-moderation/ai-moderation.service.spec.ts (GitHub
// issue #340, D81) — same verdict parsing/mapping logic, minus the
// storeVerdict()/autoApprove() side effects: this service only returns the
// parsed VerdictResult (or null), never writes to Postgres or calls
// ModerationService. The auto-approval-routing describe blocks that used
// to assert against ModerationService.approveWithAudit() live in api's own
// verdict-consumer.service.spec.ts now — this file only asserts the
// autoApprovalEligible flag lands correctly in the returned verdict.
describe('AnalysisService', () => {
  const originalEnv = { ...process.env };

  let prisma: {
    roundRating: { findUnique: jest.Mock };
    recruiterRating: { findUnique: jest.Mock };
    overallReview: { findUnique: jest.Mock };
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
      roundRating: { findUnique: jest.fn() },
      recruiterRating: { findUnique: jest.fn() },
      overallReview: { findUnique: jest.fn() },
    };
    anthropicClient = { messages: { create: jest.fn<Promise<unknown>, [RequestParams]>() } };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function buildService(client: unknown = anthropicClient): AnalysisService {
    return new AnalysisService(client as never, prisma as unknown as PrismaService);
  }

  it('is a no-op when the feature is disabled (no client configured)', async () => {
    const service = buildService(null);

    const result = await service.computeVerdict('round_rating', 'rating-1');

    expect(result).toBeNull();
    expect(prisma.roundRating.findUnique).not.toHaveBeenCalled();
  });

  it('builds round-rating content from the entity and its round, then returns the parsed verdict', async () => {
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
    const result = await service.computeVerdict('round_rating', 'rating-1');

    expect(prisma.roundRating.findUnique).toHaveBeenCalledWith({
      where: { id: 'rating-1' },
      include: { round: true },
    });
    const call: RequestParams = anthropicClient.messages.create.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-4-5');
    expect(call.messages[0].content).toContain('coding');
    expect(call.messages[0].content).toContain('DFS');
    expect(call.messages[0].content).toContain('Fine round, nothing notable.');

    expect(result?.verdict).toEqual({
      concerning: false,
      reasons: [],
      summary: 'Looks fine.',
      confidence: 0.9,
      model: 'claude-haiku-4-5',
      analyzedAt: expect.any(String) as string,
      autoApprovalEligible: false,
    });
    expect(result?.confidence).toBe(0.9);
    expect(result?.model).toBe('claude-haiku-4-5');
  });

  describe('auto-approval eligibility routing (GitHub issue #439, D71)', () => {
    beforeEach(() => {
      process.env.AI_AUTO_APPROVAL_ENABLED = 'true';
    });

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

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result?.verdict.autoApprovalEligible).toBe(true);
    });

    it('is not eligible when confidence is below the configured threshold', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '0.8';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 0.79 }),
      );

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result?.verdict.autoApprovalEligible).toBe(false);
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

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result?.verdict.autoApprovalEligible).toBe(false);
    });

    it('is never eligible when the threshold env var is unset, even for a clean, high-confidence verdict', async () => {
      delete process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD;
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result?.verdict.autoApprovalEligible).toBe(false);
    });

    it('is never eligible when the threshold env var is an explicit empty string, same as unset (GitHub issue #450)', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result?.verdict.autoApprovalEligible).toBe(false);
    });

    it('returns null when the threshold env var is set but out of range', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '1.5';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result).toBeNull();
    });

    it('returns null when the threshold env var is set but unparseable', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = 'not-a-number';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result).toBeNull();
    });

    it('is not eligible when the model omits confidence entirely', async () => {
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '0.5';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.' }),
      );

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result?.verdict.autoApprovalEligible).toBe(false);
    });
  });

  describe('auto-approval kill switch (GitHub issue #441, D71)', () => {
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

    it('is not eligible when AI_AUTO_APPROVAL_ENABLED is unset, even when clean and above threshold', async () => {
      delete process.env.AI_AUTO_APPROVAL_ENABLED;
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '0.5';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result?.verdict.autoApprovalEligible).toBe(false);
    });

    it('is not eligible when AI_AUTO_APPROVAL_ENABLED is set to any value other than "true"', async () => {
      process.env.AI_AUTO_APPROVAL_ENABLED = 'TRUE';
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '0.5';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result?.verdict.autoApprovalEligible).toBe(false);
    });

    it('is eligible when AI_AUTO_APPROVAL_ENABLED is "true" and every other condition is met', async () => {
      process.env.AI_AUTO_APPROVAL_ENABLED = 'true';
      process.env.AI_MODERATION_AUTO_APPROVE_THRESHOLD = '0.5';
      mockCleanRating();
      anthropicClient.messages.create.mockResolvedValue(
        textResponse({ concerning: false, reasons: [], summary: 'Looks fine.', confidence: 1 }),
      );

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result?.verdict.autoApprovalEligible).toBe(true);
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
    anthropicClient.messages.create.mockResolvedValue(textResponse({ concerning: false, reasons: [], summary: 'Fine.' }));

    const service = buildService();
    const result = await service.computeVerdict('recruiter_rating', 'recruiter-rating-1');

    const call: RequestParams = anthropicClient.messages.create.mock.calls[0][0];
    expect(call.messages[0].content).toContain('recruiter interaction rating');
    expect(result?.verdict.concerning).toBe(false);
  });

  it('builds overall-review content from just the entity itself', async () => {
    prisma.overallReview.findUnique.mockResolvedValue({
      id: 'review-1',
      overallExperience: 5,
      wouldRecommend: true,
      reviewText: 'Great process overall.',
    });
    anthropicClient.messages.create.mockResolvedValue(textResponse({ concerning: false, reasons: [], summary: 'Fine.' }));

    const service = buildService();
    const result = await service.computeVerdict('overall_review', 'review-1');

    const call: RequestParams = anthropicClient.messages.create.mock.calls[0][0];
    expect(call.messages[0].content).toContain('overall interview process review');
    expect(result).not.toBeNull();
  });

  it('does not call the model at all when the entity no longer exists', async () => {
    prisma.roundRating.findUnique.mockResolvedValue(null);

    const result = await buildService().computeVerdict('round_rating', 'gone');

    expect(result).toBeNull();
    expect(anthropicClient.messages.create).not.toHaveBeenCalled();
  });

  it('returns null when the model refuses the request', async () => {
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

    const result = await buildService().computeVerdict('round_rating', 'rating-1');

    expect(result).toBeNull();
  });

  it('parses a verdict wrapped in a markdown code fence, despite the system prompt asking for bare JSON (GitHub issue #453)', async () => {
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
      content: [
        {
          type: 'text',
          text: '```json\n{"concerning": false, "reasons": [], "summary": "Looks fine.", "confidence": 0.9}\n```',
        },
      ],
    });

    const result = await buildService().computeVerdict('round_rating', 'rating-1');

    expect(result?.verdict.concerning).toBe(false);
    expect(result?.confidence).toBe(0.9);
  });

  it('returns null instead of throwing on an unparseable response', async () => {
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

    await expect(buildService().computeVerdict('round_rating', 'rating-1')).resolves.toBeNull();
  });

  it('returns null instead of throwing on a network/API error from the client', async () => {
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

    await expect(buildService().computeVerdict('round_rating', 'rating-1')).resolves.toBeNull();
  });

  // GitHub issue #827 (Phase 57) — retryable (429/5xx/connection) errors are
  // still swallowed to null, same as every other failure mode (nothing
  // downstream should behave differently), but they're logged at a
  // distinct severity so an operator can tell "the SDK's own retries were
  // exhausted, this may self-heal" apart from a terminal failure.
  describe('retryable-vs-terminal error logging (GitHub issue #827)', () => {
    function mockRating(): void {
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
    }

    it.each([
      ['a 429 rate-limit error', new Anthropic.RateLimitError(429, {}, 'rate limited', new Headers())],
      ['a 500 internal-server error', new Anthropic.InternalServerError(500, {}, 'internal error', new Headers())],
      [
        'a connection error',
        new Anthropic.APIConnectionError({ message: 'connection reset' }),
      ],
    ])('logs %s as a warning, not an error, and still returns null', async (_label, err) => {
      mockRating();
      anthropicClient.messages.create.mockRejectedValue(err);
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('logs a terminal error (e.g. a 400 bad request) as an error, not a warning', async () => {
      mockRating();
      anthropicClient.messages.create.mockRejectedValue(new Anthropic.BadRequestError(400, {}, 'bad request', new Headers()));
      const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      const result = await buildService().computeVerdict('round_rating', 'rating-1');

      expect(result).toBeNull();
      expect(errorSpy).toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  it('returns null (surfaced as a caught, logged failure) when ANTHROPIC_MODEL is unset', async () => {
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

    const result = await buildService().computeVerdict('round_rating', 'rating-1');

    expect(result).toBeNull();
    expect(anthropicClient.messages.create).not.toHaveBeenCalled();
  });
});
