import { Test, TestingModule } from '@nestjs/testing';
import { SlaBreachDetectionService } from './sla-breach-detection.service';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventPublisher } from '../events/domain-event-publisher';
import { MODERATION_QUEUE_SLA_BREACH_V1_TOPIC } from '../events/schemas/moderation-queue-sla-breach.event';

describe('SlaBreachDetectionService', () => {
  let service: SlaBreachDetectionService;
  let prisma: {
    moderationQueueEntry: { findMany: jest.Mock; update: jest.Mock };
  };
  let domainEventPublisher: { publish: jest.Mock };

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

  it('queries only unreviewed, not-yet-notified entries past their SLA deadline', async () => {
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
    const slaDeadline = new Date('2026-08-01T00:00:00Z');
    prisma.moderationQueueEntry.findMany.mockResolvedValue([
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
    prisma.moderationQueueEntry.findMany.mockResolvedValue([
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
    prisma.moderationQueueEntry.findMany.mockResolvedValue([
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
    prisma.moderationQueueEntry.findMany.mockResolvedValue([
      { id: 'queue-1', entityType: 'round_rating', entityId: 'r1', slaDeadline: new Date(), claimedById: null },
      { id: 'queue-2', entityType: 'overall_review', entityId: 'r2', slaDeadline: new Date(), claimedById: 'mod-1' },
    ]);

    await service.sweep();

    expect(domainEventPublisher.publish).toHaveBeenCalledTimes(2);
    expect(prisma.moderationQueueEntry.update).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there are no breached entries', async () => {
    await service.sweep();

    expect(domainEventPublisher.publish).not.toHaveBeenCalled();
    expect(prisma.moderationQueueEntry.update).not.toHaveBeenCalled();
  });

  it('still stamps breachNotifiedAt even if the publish itself is a no-op (broker unreachable, D53 best-effort contract)', async () => {
    // DomainEventPublisher.publish() never throws/rejects on a broker
    // failure (it swallows internally) — this proves the stamp isn't
    // conditioned on some signal that doesn't actually exist.
    domainEventPublisher.publish.mockResolvedValue(undefined);
    prisma.moderationQueueEntry.findMany.mockResolvedValue([
      { id: 'queue-1', entityType: 'round_rating', entityId: 'r1', slaDeadline: new Date(), claimedById: null },
    ]);

    await service.sweep();

    expect(prisma.moderationQueueEntry.update).toHaveBeenCalled();
  });

  it('logs and continues if stamping breachNotifiedAt itself fails, without throwing', async () => {
    prisma.moderationQueueEntry.findMany.mockResolvedValue([
      { id: 'queue-1', entityType: 'round_rating', entityId: 'r1', slaDeadline: new Date(), claimedById: null },
    ]);
    prisma.moderationQueueEntry.update.mockRejectedValue(new Error('connection lost'));

    await expect(service.sweep()).resolves.toBeUndefined();
  });
});
