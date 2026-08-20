import { Consumer } from 'kafkajs';
import {
  VerdictConsumerService,
  AUTO_APPROVAL_SYSTEM_ACTOR,
  RECONCILIATION_SWEEP_SYSTEM_ACTOR,
  parseVerdictComputedEvent,
} from './verdict-consumer.service';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';

// GitHub issue #340 (Phase 32, D81) — api's first-ever event consumer.
// Instantiated directly (not via the Nest DI container), same pattern
// api's deleted ai-moderation.service.spec.ts/reconciliation-sweep.service.spec.ts
// used: no module wiring needed for these tests, which exercise
// processEvent() directly against a plain event object.
describe('VerdictConsumerService', () => {
  let prisma: {
    roundRating: { update: jest.Mock };
    recruiterRating: { update: jest.Mock };
    overallReview: { update: jest.Mock };
    moderationQueueEntry: { findFirst: jest.Mock };
  };
  let moderationService: { approveWithAudit: jest.Mock; flag: jest.Mock };
  let consumer: { on: jest.Mock; events: { DISCONNECT: string } };

  beforeEach(() => {
    prisma = {
      roundRating: { update: jest.fn().mockResolvedValue(undefined) },
      recruiterRating: { update: jest.fn().mockResolvedValue(undefined) },
      overallReview: { update: jest.fn().mockResolvedValue(undefined) },
      moderationQueueEntry: { findFirst: jest.fn() },
    };
    moderationService = {
      approveWithAudit: jest.fn().mockResolvedValue(undefined),
      flag: jest.fn().mockResolvedValue(undefined),
    };
    consumer = { on: jest.fn(), events: { DISCONNECT: 'consumer.disconnect' } };
  });

  function buildService(): VerdictConsumerService {
    return new VerdictConsumerService(
      consumer as unknown as Consumer,
      prisma as unknown as PrismaService,
      moderationService as unknown as ModerationService,
    );
  }

  function roundRatingEvent(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      eventType: 'moderation.round_rating.verdict_computed' as const,
      eventVersion: 1 as const,
      occurredAt: new Date().toISOString(),
      roundRatingId: 'rating-1',
      verdict: { concerning: false, autoApprovalEligible: false },
      autoApprovalEligible: false,
      confidence: 0.9,
      model: 'claude-haiku-4-5',
      promptContent: 'p',
      responseText: 'r',
      ...overrides,
    };
  }

  // GitHub issue #782 (Phase 52) — schema validation at the parse
  // boundary, before anything is trusted downstream. Uses a real UUID for
  // roundRatingId (unlike roundRatingEvent()'s own 'rating-1' default,
  // fine for processEvent()'s tests below since those never go through
  // schema validation) — parseVerdictComputedEvent enforces @IsUUID().
  const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  describe('parseVerdictComputedEvent', () => {
    it('parses a well-formed round_rating verdict event', () => {
      const event = parseVerdictComputedEvent(
        JSON.stringify(roundRatingEvent({ roundRatingId: VALID_UUID })),
      );
      expect(event).toMatchObject({
        eventType: 'moderation.round_rating.verdict_computed',
        roundRatingId: VALID_UUID,
      });
    });

    it('rejects an unrecognized eventType', () => {
      expect(() =>
        parseVerdictComputedEvent(JSON.stringify(roundRatingEvent({ eventType: 'not.a.real.event' }))),
      ).toThrow(/Unrecognized eventType/);
    });

    it('rejects a payload missing a required field', () => {
      const { autoApprovalEligible: _drop, ...withoutRequiredField } = roundRatingEvent();
      expect(() => parseVerdictComputedEvent(JSON.stringify(withoutRequiredField))).toThrow(
        /failed schema validation/,
      );
    });

    it('rejects a wrong-typed field (confidence as a string instead of a number)', () => {
      expect(() =>
        parseVerdictComputedEvent(JSON.stringify(roundRatingEvent({ confidence: 'high' }))),
      ).toThrow(/failed schema validation/);
    });

    it('rejects an id that is not a real UUID', () => {
      expect(() =>
        parseVerdictComputedEvent(JSON.stringify(roundRatingEvent({ roundRatingId: 'not-a-uuid' }))),
      ).toThrow(/failed schema validation/);
    });

    it('allows verdict/confidence/model/promptContent/responseText to be null', () => {
      const event = parseVerdictComputedEvent(
        JSON.stringify(
          roundRatingEvent({
            roundRatingId: VALID_UUID,
            verdict: null,
            confidence: null,
            model: null,
            promptContent: null,
            responseText: null,
          }),
        ),
      );
      expect(event.verdict).toBeNull();
    });

    it('rejects an eventType that does not match its own DTO (cross-type payload)', () => {
      const mismatched = {
        ...roundRatingEvent({ roundRatingId: VALID_UUID }),
        eventType: 'moderation.recruiter_rating.verdict_computed',
      };
      expect(() => parseVerdictComputedEvent(JSON.stringify(mismatched))).toThrow(
        /failed schema validation/,
      );
    });

    it('accepts a well-formed stalled event with nullable fields', () => {
      const event = parseVerdictComputedEvent(
        JSON.stringify(
          roundRatingEvent({
            roundRatingId: VALID_UUID,
            stalled: true,
            verdict: null,
            confidence: null,
            model: null,
          }),
        ),
      );
      expect(event.stalled).toBe(true);
    });
  });

  it('stores the verdict onto the round rating row', async () => {
    const service = buildService();

    await service.processEvent(roundRatingEvent());

    expect(prisma.roundRating.update).toHaveBeenCalledWith({
      where: { id: 'rating-1' },
      data: { moderationVerdict: { concerning: false, autoApprovalEligible: false } },
    });
  });

  it('stores the verdict onto the recruiter rating row', async () => {
    const service = buildService();

    await service.processEvent({
      eventType: 'moderation.recruiter_rating.verdict_computed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      recruiterRatingId: 'recruiter-rating-1',
      verdict: { concerning: false },
      autoApprovalEligible: false,
      confidence: 0.9,
      model: 'claude-haiku-4-5',
      promptContent: 'p',
      responseText: 'r',
    });

    expect(prisma.recruiterRating.update).toHaveBeenCalledWith({
      where: { id: 'recruiter-rating-1' },
      data: { moderationVerdict: { concerning: false } },
    });
  });

  it('stores the verdict onto the overall review row', async () => {
    const service = buildService();

    await service.processEvent({
      eventType: 'moderation.overall_review.verdict_computed',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      overallReviewId: 'review-1',
      verdict: { concerning: false },
      autoApprovalEligible: false,
      confidence: 0.9,
      model: 'claude-haiku-4-5',
      promptContent: 'p',
      responseText: 'r',
    });

    expect(prisma.overallReview.update).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: { moderationVerdict: { concerning: false } },
    });
  });

  describe('auto-approval (GitHub issue #440, D71)', () => {
    it('routes an eligible verdict through approveWithAudit, attributed to the system actor', async () => {
      prisma.moderationQueueEntry.findFirst.mockResolvedValue({ id: 'queue-entry-1' });
      const service = buildService();

      await service.processEvent(
        roundRatingEvent({ autoApprovalEligible: true, verdict: { concerning: false, autoApprovalEligible: true } }),
      );

      expect(prisma.moderationQueueEntry.findFirst).toHaveBeenCalledWith({
        where: { entityType: 'round_rating', entityId: 'rating-1', reviewedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(moderationService.approveWithAudit).toHaveBeenCalledWith(
        'queue-entry-1',
        { reviewedBy: AUTO_APPROVAL_SYSTEM_ACTOR },
        expect.objectContaining({
          entityType: 'round_rating',
          entityId: 'rating-1',
          confidence: 0.9,
          model: 'claude-haiku-4-5',
          promptContent: 'p',
          responseText: 'r',
        }),
      );
    });

    it('does not call approveWithAudit when the event is not auto-approval eligible', async () => {
      const service = buildService();

      await service.processEvent(roundRatingEvent({ autoApprovalEligible: false }));

      expect(prisma.moderationQueueEntry.findFirst).not.toHaveBeenCalled();
      expect(moderationService.approveWithAudit).not.toHaveBeenCalled();
    });

    it('leaves the entity advisory-only (never throws) when no pending queue entry is found', async () => {
      prisma.moderationQueueEntry.findFirst.mockResolvedValue(null);
      const service = buildService();

      await expect(service.processEvent(roundRatingEvent({ autoApprovalEligible: true }))).resolves.toBeUndefined();

      expect(moderationService.approveWithAudit).not.toHaveBeenCalled();
    });

    // GitHub issue #689 (Phase 49, D104) — a resubmission past the
    // lifetime cap needs a human admin's judgment, not another
    // automated pass.
    it('leaves the entity advisory-only (never throws) when the queue entry is escalated', async () => {
      prisma.moderationQueueEntry.findFirst.mockResolvedValue({ id: 'queue-entry-1', escalated: true });
      const service = buildService();

      await expect(service.processEvent(roundRatingEvent({ autoApprovalEligible: true }))).resolves.toBeUndefined();

      expect(moderationService.approveWithAudit).not.toHaveBeenCalled();
    });
  });

  describe('stalled escalation (GitHub issue #442, D71, ported from review-analyzer via #340)', () => {
    it('escalates to a human-visible flag when the event is marked stalled', async () => {
      prisma.moderationQueueEntry.findFirst.mockResolvedValue({ id: 'queue-entry-1' });
      const service = buildService();

      await service.processEvent(
        roundRatingEvent({ stalled: true, verdict: null, autoApprovalEligible: false, confidence: null, model: null }),
      );

      expect(moderationService.flag).toHaveBeenCalledWith('queue-entry-1', {
        reviewedBy: RECONCILIATION_SWEEP_SYSTEM_ACTOR,
        flagReason: 'ai_triage_stalled',
      });
      expect(prisma.roundRating.update).not.toHaveBeenCalled();
    });

    it('logs and does not throw when no pending moderation queue entry is found to flag', async () => {
      prisma.moderationQueueEntry.findFirst.mockResolvedValue(null);
      const service = buildService();

      await expect(
        service.processEvent(roundRatingEvent({ stalled: true, verdict: null })),
      ).resolves.toBeUndefined();

      expect(moderationService.flag).not.toHaveBeenCalled();
    });
  });
});
