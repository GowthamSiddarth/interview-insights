import { Test, TestingModule } from '@nestjs/testing';
import { SlaBreachDetectionService } from './sla-breach-detection.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import { MODERATION_QUEUE_SLA_BREACH_V1_TOPIC } from '../events/schemas/moderation-queue-sla-breach.event';
import { MODERATION_QUEUE_SLA_WARNING_V1_TOPIC } from '../events/schemas/moderation-queue-sla-warning.event';

describe('SlaBreachDetectionService', () => {
  let service: SlaBreachDetectionService;
  let prisma: {
    moderationQueueEntry: { findMany: jest.Mock; update: jest.Mock };
  };
  let domainEventPublisher: { publish: jest.Mock };

  // GitHub issue #704 (Phase 51, D104) — sweep() now runs sweepWarnings()
  // then sweepBreaches(), each its own findMany() call. Every test below
  // that only cares about one tier stubs the *other* tier's call to
  // return [] via mockResolvedValueOnce, in call order, so it can't
  // accidentally pick up the other tier's fixture data and double-count
  // publish()/update() calls.
  function mockNoWarnableEntries() {
    prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([]);
  }

  beforeEach(async () => {
    prisma = {
      moderationQueueEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    domainEventPublisher = { publish: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaBreachDetectionService,
        { provide: PrismaService, useValue: prisma },
        { provide: DomainEventPublisher, useValue: domainEventPublisher },
      ],
    }).compile();

    service = module.get(SlaBreachDetectionService);
  });

  describe('breach tier (100% elapsed)', () => {
    it('queries only unreviewed, not-yet-notified entries past their SLA deadline', async () => {
      mockNoWarnableEntries();

      await service.sweep();

      expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith({
        where: {
          reviewedAt: null,
          breachNotifiedAt: null,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
          slaDeadline: { lt: expect.any(Date) },
        },
        select: { id: true, entityType: true, entityId: true, slaDeadline: true, claimedById: true },
      });
    });

    it('publishes a sla_breach event per breached entry, carrying claimedById through unchanged', async () => {
      mockNoWarnableEntries();
      const slaDeadline = new Date('2026-08-01T00:00:00Z');
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-1', entityType: 'round_rating', entityId: 'rating-1', slaDeadline, claimedById: 'mod-1' },
      ]);

      await service.sweep();

      expect(domainEventPublisher.publish).toHaveBeenCalledWith(
        MODERATION_QUEUE_SLA_BREACH_V1_TOPIC,
        expect.objectContaining({
          eventType: 'moderation.queue.sla_breach',
          eventVersion: 1,
          queueEntryId: 'queue-1',
          entityType: 'round_rating',
          entityId: 'rating-1',
          slaDeadline: slaDeadline.toISOString(),
          claimedById: 'mod-1',
        }),
        'queue-1',
      );
    });

    it('publishes claimedById: null for an unclaimed breached entry', async () => {
      mockNoWarnableEntries();
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-1', entityType: 'company', entityId: 'company-1', slaDeadline: new Date(), claimedById: null },
      ]);

      await service.sweep();

      expect(domainEventPublisher.publish).toHaveBeenCalledWith(
        MODERATION_QUEUE_SLA_BREACH_V1_TOPIC,
        expect.objectContaining({ claimedById: null }),
        'queue-1',
      );
    });

    it('stamps breachNotifiedAt after publishing, so a later sweep never re-notifies the same entry', async () => {
      mockNoWarnableEntries();
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-1', entityType: 'round_rating', entityId: 'rating-1', slaDeadline: new Date(), claimedById: null },
      ]);

      await service.sweep();

      expect(prisma.moderationQueueEntry.update).toHaveBeenCalledWith({
        where: { id: 'queue-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { breachNotifiedAt: expect.any(Date) },
      });
    });

    it('processes every breached entry the query returns', async () => {
      mockNoWarnableEntries();
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-1', entityType: 'round_rating', entityId: 'r1', slaDeadline: new Date(), claimedById: null },
        { id: 'queue-2', entityType: 'overall_review', entityId: 'r2', slaDeadline: new Date(), claimedById: 'mod-1' },
      ]);

      await service.sweep();

      expect(domainEventPublisher.publish).toHaveBeenCalledTimes(2);
      expect(prisma.moderationQueueEntry.update).toHaveBeenCalledTimes(2);
    });

    it('does nothing when there are no breached (or warnable) entries', async () => {
      await service.sweep();

      expect(domainEventPublisher.publish).not.toHaveBeenCalled();
      expect(prisma.moderationQueueEntry.update).not.toHaveBeenCalled();
    });

    it('still stamps breachNotifiedAt even if the publish itself is a no-op (broker unreachable, D53 best-effort contract)', async () => {
      mockNoWarnableEntries();
      // DomainEventPublisher.publish() never throws/rejects on a broker
      // failure (it swallows internally) — this proves the stamp isn't
      // conditioned on some signal that doesn't actually exist.
      domainEventPublisher.publish.mockResolvedValue(undefined);
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-1', entityType: 'round_rating', entityId: 'r1', slaDeadline: new Date(), claimedById: null },
      ]);

      await service.sweep();

      expect(prisma.moderationQueueEntry.update).toHaveBeenCalled();
    });

    it('logs and continues if stamping breachNotifiedAt itself fails, without throwing', async () => {
      mockNoWarnableEntries();
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-1', entityType: 'round_rating', entityId: 'r1', slaDeadline: new Date(), claimedById: null },
      ]);
      prisma.moderationQueueEntry.update.mockRejectedValue(new Error('connection lost'));

      await expect(service.sweep()).resolves.toBeUndefined();
    });
  });

  // GitHub issue #704 (Phase 51, D104).
  describe('warning tier (75% elapsed, still unclaimed)', () => {
    it('queries only unreviewed, unclaimed, not-yet-warned entries within the warning window', async () => {
      await service.sweep();

      expect(prisma.moderationQueueEntry.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          reviewedAt: null,
          claimedById: null,
          warningNotifiedAt: null,
          slaDeadline: {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
            gt: expect.any(Date),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
            lte: expect.any(Date),
          },
        },
        select: { id: true, entityType: true, entityId: true, slaDeadline: true },
      });
    });

    it('publishes a sla_warning event per warnable entry', async () => {
      const slaDeadline = new Date(Date.now() + 60 * 60 * 1000);
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-1', entityType: 'round_rating', entityId: 'rating-1', slaDeadline },
      ]);

      await service.sweep();

      expect(domainEventPublisher.publish).toHaveBeenCalledWith(
        MODERATION_QUEUE_SLA_WARNING_V1_TOPIC,
        expect.objectContaining({
          eventType: 'moderation.queue.sla_warning',
          eventVersion: 1,
          queueEntryId: 'queue-1',
          entityType: 'round_rating',
          entityId: 'rating-1',
          slaDeadline: slaDeadline.toISOString(),
        }),
        'queue-1',
      );
    });

    it('stamps warningNotifiedAt after publishing, so a later sweep never re-warns the same entry', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-1', entityType: 'round_rating', entityId: 'rating-1', slaDeadline: new Date() },
      ]);

      await service.sweep();

      expect(prisma.moderationQueueEntry.update).toHaveBeenCalledWith({
        where: { id: 'queue-1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        data: { warningNotifiedAt: expect.any(Date) },
      });
    });

    it('never publishes a sla_breach event for an entry only the warning tier picked up', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-1', entityType: 'round_rating', entityId: 'rating-1', slaDeadline: new Date() },
      ]);
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([]);

      await service.sweep();

      expect(domainEventPublisher.publish).not.toHaveBeenCalledWith(
        MODERATION_QUEUE_SLA_BREACH_V1_TOPIC,
        expect.anything(),
        expect.anything(),
      );
    });

    it('runs the warning sweep before the breach sweep, both tiers independently', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-warn', entityType: 'round_rating', entityId: 'r1', slaDeadline: new Date() },
      ]);
      prisma.moderationQueueEntry.findMany.mockResolvedValueOnce([
        { id: 'queue-breach', entityType: 'overall_review', entityId: 'r2', slaDeadline: new Date(), claimedById: null },
      ]);

      await service.sweep();

      expect(domainEventPublisher.publish).toHaveBeenCalledTimes(2);
      expect(domainEventPublisher.publish).toHaveBeenNthCalledWith(
        1,
        MODERATION_QUEUE_SLA_WARNING_V1_TOPIC,
        expect.anything(),
        'queue-warn',
      );
      expect(domainEventPublisher.publish).toHaveBeenNthCalledWith(
        2,
        MODERATION_QUEUE_SLA_BREACH_V1_TOPIC,
        expect.anything(),
        'queue-breach',
      );
    });
  });
});
