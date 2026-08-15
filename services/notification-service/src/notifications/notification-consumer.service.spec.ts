import { createCipheriv, randomBytes } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { EachMessagePayload } from 'kafkajs';
import { Prisma } from '@prisma/client';
import { NotificationConsumerService } from './notification-consumer.service';
import { EVENT_CONSUMER } from '../events/redpanda-client.provider';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RoundRatingCreatedEventV1 } from '../events/schemas/round-rating-created.event';
import { RecruiterRatingCreatedEventV1 } from '../events/schemas/recruiter-rating-created.event';
import { OverallReviewCreatedEventV1 } from '../events/schemas/overall-review-created.event';
import { RoundRatingStatusChangedEventV1 } from '../events/schemas/round-rating-status-changed.event';
import { CompanyCreatedEventV1 } from '../events/schemas/company-created.event';
import { CompanyStatusChangedEventV1 } from '../events/schemas/company-status-changed.event';
import { ModerationQueueSlaBreachEventV1 } from '../events/schemas/moderation-queue-sla-breach.event';
import { ModerationQueueSlaWarningEventV1 } from '../events/schemas/moderation-queue-sla-warning.event';
import { StaffNotificationRecipientsService } from './staff-notification-recipients.service';

const ENCRYPTION_KEY = 'a'.repeat(64);

function encryptFixture(email: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function fakeConsumer() {
  return {
    events: { DISCONNECT: 'consumer.disconnect' },
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
}

describe('NotificationConsumerService', () => {
  let service: NotificationConsumerService;
  let prisma: {
    candidate: { findUnique: jest.Mock };
    moderator: { findUnique: jest.Mock };
    notificationLog: { findUnique: jest.Mock; create: jest.Mock };
  };
  let mailService: { send: jest.Mock };
  let staffNotificationRecipients: { activeModeratorEmails: jest.Mock; activeAdminEmails: jest.Mock };
  const originalKey = process.env.EMAIL_ENCRYPTION_KEY;

  const roundRatingEvent: RoundRatingCreatedEventV1 = {
    eventType: 'moderation.round_rating.created',
    eventVersion: 1,
    occurredAt: '2026-07-30T00:00:00.000Z',
    roundRatingId: 'rating-1',
    roundId: 'round-1',
    candidateId: 'candidate-1',
    companyId: 'company-1',
    status: 'pending',
  };

  const slaBreachEvent = (claimedById: string | null): ModerationQueueSlaBreachEventV1 => ({
    eventType: 'moderation.queue.sla_breach',
    eventVersion: 1,
    occurredAt: '2026-08-04T00:00:00.000Z',
    queueEntryId: 'queue-1',
    entityType: 'round_rating',
    entityId: 'rating-1',
    slaDeadline: '2026-08-01T00:00:00.000Z',
    claimedById,
  });

  // GitHub issue #704 (Phase 51, D104).
  const slaWarningEvent: ModerationQueueSlaWarningEventV1 = {
    eventType: 'moderation.queue.sla_warning',
    eventVersion: 1,
    occurredAt: '2026-08-15T00:00:00.000Z',
    queueEntryId: 'queue-1',
    entityType: 'round_rating',
    entityId: 'rating-1',
    slaDeadline: '2026-08-16T00:00:00.000Z',
  };

  const statusChangedEvent = (newStatus: 'approved' | 'rejected' | 'flagged'): RoundRatingStatusChangedEventV1 => ({
    eventType: 'moderation.round_rating.status_changed',
    eventVersion: 1,
    occurredAt: '2026-07-30T00:00:00.000Z',
    roundRatingId: 'rating-1',
    roundId: 'round-1',
    candidateId: 'candidate-1',
    companyId: 'company-1',
    previousStatus: 'pending',
    newStatus,
    moderationQueueEntryId: 'queue-1',
  });

  // GitHub issue #698 (Phase 50, D104).
  const companyCreatedEvent: CompanyCreatedEventV1 = {
    eventType: 'moderation.company.created',
    eventVersion: 1,
    occurredAt: '2026-08-15T00:00:00.000Z',
    companyId: 'company-1',
    candidateId: 'candidate-1',
    status: 'pending',
  };

  const companyStatusChangedEvent = (
    newStatus: 'approved' | 'rejected' | 'flagged',
  ): CompanyStatusChangedEventV1 => ({
    eventType: 'moderation.company.status_changed',
    eventVersion: 1,
    occurredAt: '2026-08-15T00:00:00.000Z',
    companyId: 'company-1',
    candidateId: 'candidate-1',
    previousStatus: 'pending',
    newStatus,
    moderationQueueEntryId: 'queue-1',
  });

  beforeEach(async () => {
    process.env.EMAIL_ENCRYPTION_KEY = ENCRYPTION_KEY;
    prisma = {
      candidate: { findUnique: jest.fn() },
      moderator: { findUnique: jest.fn() },
      notificationLog: { findUnique: jest.fn(), create: jest.fn() },
    };
    mailService = { send: jest.fn().mockResolvedValue(undefined) };
    staffNotificationRecipients = {
      activeModeratorEmails: jest.fn().mockResolvedValue([]),
      activeAdminEmails: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationConsumerService,
        { provide: EVENT_CONSUMER, useValue: fakeConsumer() },
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mailService },
        { provide: StaffNotificationRecipientsService, useValue: staffNotificationRecipients },
      ],
    }).compile();

    service = module.get(NotificationConsumerService);
  });

  afterEach(() => {
    process.env.EMAIL_ENCRYPTION_KEY = originalKey;
  });

  describe('processEvent', () => {
    it('decrypts the candidate email and sends the pending-review email, then records it', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(roundRatingEvent);

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'candidate@example.com', subject: 'Your submission is pending review' }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'round_rating',
          entityId: 'rating-1',
          eventType: 'moderation.round_rating.created',
          moderationQueueEntryId: '',
        },
      });
    });

    // GitHub issue #692 (Phase 49, D104).
    it('sends a distinct "back in review" email for a resubmission created event, keyed by its own queue entry', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent({
        ...roundRatingEvent,
        isResubmission: true,
        moderationQueueEntryId: 'queue-2',
      });

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'candidate@example.com',
          subject: 'Your edited submission is back in review',
        }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'round_rating',
          entityId: 'rating-1',
          eventType: 'moderation.round_rating.created',
          moderationQueueEntryId: 'queue-2',
        },
      });
    });

    // GitHub issue #692 (Phase 49, D104) — the exact bug #692's own
    // acceptance criteria calls out: without moderationQueueEntryIdFor()
    // keying a resubmission ack separately, this lookup would find the
    // original submission's already-sent dedup row (both keyed '') and
    // wrongly skip the resubmission email.
    it("doesn't collide with the original submission's created notification dedup row", async () => {
      prisma.notificationLog.findUnique.mockImplementation(
        ({ where }: { where: { notification_log_dedup_key: { moderationQueueEntryId: string } } }) =>
          Promise.resolve(where.notification_log_dedup_key.moderationQueueEntryId === '' ? {} : null),
      );
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent({
        ...roundRatingEvent,
        isResubmission: true,
        moderationQueueEntryId: 'queue-2',
      });

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Your edited submission is back in review' }),
      );
    });

    it('maps recruiter_rating and overall_review events to their own id fields', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      const recruiterEvent: RecruiterRatingCreatedEventV1 = {
        eventType: 'moderation.recruiter_rating.created',
        eventVersion: 1,
        occurredAt: '2026-07-30T00:00:00.000Z',
        recruiterRatingId: 'recruiter-rating-1',
        recruiterInteractionId: 'interaction-1',
        candidateId: 'candidate-1',
        companyId: 'company-1',
        status: 'pending',
      };
      await service.processEvent(recruiterEvent);
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'recruiter_rating',
          entityId: 'recruiter-rating-1',
          eventType: 'moderation.recruiter_rating.created',
          moderationQueueEntryId: '',
        },
      });

      const overallEvent: OverallReviewCreatedEventV1 = {
        eventType: 'moderation.overall_review.created',
        eventVersion: 1,
        occurredAt: '2026-07-30T00:00:00.000Z',
        overallReviewId: 'review-1',
        processId: 'process-1',
        candidateId: 'candidate-1',
        companyId: 'company-1',
        status: 'pending',
      };
      await service.processEvent(overallEvent);
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'overall_review',
          entityId: 'review-1',
          eventType: 'moderation.overall_review.created',
          moderationQueueEntryId: '',
        },
      });
    });

    it('never sends twice for the same entity+eventType — the idempotency the issue requires', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({ id: 'log-1' });

      await service.processEvent(roundRatingEvent);

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.candidate.findUnique).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('swallows a unique-constraint race on the final record (both processed the same redelivery)', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.notificationLog.create.mockRejectedValue(conflict);

      await expect(service.processEvent(roundRatingEvent)).resolves.toBeUndefined();
      expect(mailService.send).toHaveBeenCalled();
    });

    it('does not record success if the email send itself fails (a transient SMTP error must be retryable, not silently marked done)', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      mailService.send.mockRejectedValue(new Error('SMTP unreachable'));

      await expect(service.processEvent(roundRatingEvent)).rejects.toThrow('SMTP unreachable');

      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('skips (without throwing) when the candidate has no email on file', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({ id: 'candidate-1', emailEncrypted: null });

      await expect(service.processEvent(roundRatingEvent)).resolves.toBeUndefined();

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });
  });

  describe('processEvent — status_changed (GitHub issue #336)', () => {
    it('sends an "approved" email and records it, keyed by the status_changed eventType', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(statusChangedEvent('approved'));

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'candidate@example.com', subject: 'Your submission has been approved' }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'round_rating',
          entityId: 'rating-1',
          eventType: 'moderation.round_rating.status_changed',
          moderationQueueEntryId: 'queue-1',
        },
      });
    });

    it('sends a "rejected" email and records it', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(statusChangedEvent('rejected'));

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'candidate@example.com', subject: 'Your submission was not approved' }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'round_rating',
          entityId: 'rating-1',
          eventType: 'moderation.round_rating.status_changed',
          moderationQueueEntryId: 'queue-1',
        },
      });
    });

    it('is a no-op for "flagged" — no email sent, no idempotency lookup, no log row written', async () => {
      await service.processEvent(statusChangedEvent('flagged'));

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.notificationLog.findUnique).not.toHaveBeenCalled();
      expect(prisma.candidate.findUnique).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    // GitHub issue #687 (Phase 49, D104) — the dedup lookup is keyed on
    // moderationQueueEntryId too, not just entityType/entityId/eventType.
    it('looks up the dedup key scoped to the queue entry, not just the entity', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(statusChangedEvent('approved'));

      expect(prisma.notificationLog.findUnique).toHaveBeenCalledWith({
        where: {
          notification_log_dedup_key: {
            entityType: 'round_rating',
            entityId: 'rating-1',
            eventType: 'moderation.round_rating.status_changed',
            moderationQueueEntryId: 'queue-1',
          },
        },
      });
    });

    // The confirmed bug this issue fixes: two decisions on the same
    // entity from two different moderation_queue entries (a
    // resubmission) must each independently be treated as un-notified —
    // the second must not be swallowed by the first's dedup row.
    it('treats a decision from a different moderation_queue entry on the same entity as un-notified', async () => {
      prisma.notificationLog.findUnique.mockImplementation(
        ({ where }: { where: { notification_log_dedup_key: { moderationQueueEntryId: string } } }) =>
          Promise.resolve(where.notification_log_dedup_key.moderationQueueEntryId === 'queue-1' ? { id: 'log-1' } : null),
      );
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      // queue-1's decision was already notified — a no-op.
      await service.processEvent(statusChangedEvent('approved'));
      expect(mailService.send).not.toHaveBeenCalled();

      // A resubmission's decision, from a different queue entry — must
      // still send, not get swallowed by queue-1's dedup row.
      await service.processEvent({ ...statusChangedEvent('rejected'), moderationQueueEntryId: 'queue-2' });
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Your submission was not approved' }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'round_rating',
          entityId: 'rating-1',
          eventType: 'moderation.round_rating.status_changed',
          moderationQueueEntryId: 'queue-2',
        },
      });
    });

    it('never sends twice for the same entity+eventType — a redelivered status_changed event is a no-op', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({ id: 'log-1' });

      await service.processEvent(statusChangedEvent('approved'));

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.candidate.findUnique).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });
  });

  // GitHub issue #698 (Phase 50, D104) — company reuses every code path
  // above (entityTypeFor()/entityIdFor()'s own switches are the only
  // company-specific branches anywhere in this service), proven directly
  // rather than just inferred from the other entity types' coverage.
  describe('processEvent — company (GitHub issue #698)', () => {
    it('sends a pending-review email for a company.created event, keyed by companyId', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(companyCreatedEvent);

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'candidate@example.com', subject: 'Your submission is pending review' }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'company',
          entityId: 'company-1',
          eventType: 'moderation.company.created',
          moderationQueueEntryId: '',
        },
      });
    });

    it('sends an "approved" email for a company.status_changed event', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(companyStatusChangedEvent('approved'));

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Your submission has been approved' }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'company',
          entityId: 'company-1',
          eventType: 'moderation.company.status_changed',
          moderationQueueEntryId: 'queue-1',
        },
      });
    });

    it('sends a "rejected" email for a company.status_changed event', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(companyStatusChangedEvent('rejected'));

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Your submission was not approved' }),
      );
    });

    it('is a no-op for "flagged" — no email, no idempotency lookup, no log row (same as the other entity types)', async () => {
      await service.processEvent(companyStatusChangedEvent('flagged'));

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.notificationLog.findUnique).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('never sends twice for the same company + eventType — a redelivered event is a no-op', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({ id: 'log-1' });

      await service.processEvent(companyCreatedEvent);

      expect(mailService.send).not.toHaveBeenCalled();
    });

    // GitHub issue #692/#687 (Phase 49, D104) — a resubmitted company
    // (edited via #697's PATCH endpoint) gets a fresh moderation_queue
    // entry; its eventual decision must not collide with a prior
    // decision's already-sent dedup row.
    it("keys a resubmission's decision by its own moderation_queue entry, not the original decision's", async () => {
      prisma.notificationLog.findUnique.mockImplementation(
        ({ where }: { where: { notification_log_dedup_key: { moderationQueueEntryId: string } } }) =>
          Promise.resolve(where.notification_log_dedup_key.moderationQueueEntryId === 'queue-1' ? { id: 'log-1' } : null),
      );
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent({ ...companyStatusChangedEvent('rejected'), moderationQueueEntryId: 'queue-2' });

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Your submission was not approved' }),
      );
    });
  });

  describe('processEvent — moderation.queue.sla_breach (GitHub issue #489)', () => {
    it('resolves the claiming moderator and sends the breach email, then records it', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.moderator.findUnique.mockResolvedValue({ id: 'mod-1', email: 'moderator@example.com' });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(slaBreachEvent('mod-1'));

      expect(prisma.moderator.findUnique).toHaveBeenCalledWith({ where: { id: 'mod-1' } });
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'moderator@example.com',
          subject: 'A moderation queue item you claimed is overdue',
        }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'moderation_queue',
          entityId: 'queue-1',
          eventType: 'moderation.queue.sla_breach',
          moderationQueueEntryId: '',
        },
      });
    });

    // GitHub issue #704 (Phase 51, D104) — an unclaimed breach used to be
    // a silent no-op (skips (without touching NotificationLog)); it now
    // escalates to every active admin instead.
    it('escalates to every active admin when the entry was never claimed', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      staffNotificationRecipients.activeAdminEmails.mockResolvedValue([
        'admin-a@example.com',
        'admin-b@example.com',
      ]);
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(slaBreachEvent(null));

      expect(prisma.moderator.findUnique).not.toHaveBeenCalled();
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin-a@example.com', subject: 'A moderation queue item you claimed is overdue' }),
      );
      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'admin-b@example.com' }),
      );
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'moderation_queue',
          entityId: 'queue-1',
          eventType: 'moderation.queue.sla_breach',
          moderationQueueEntryId: '',
        },
      });
    });

    it('skips (without throwing) when unclaimed and no active admins exist to escalate to', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);

      await expect(service.processEvent(slaBreachEvent(null))).resolves.toBeUndefined();

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('never sends twice for the same queue entry — idempotent against redelivery', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({ id: 'log-1' });

      await service.processEvent(slaBreachEvent('mod-1'));

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.moderator.findUnique).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('skips (without throwing) when the claiming moderator no longer resolves', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.moderator.findUnique.mockResolvedValue(null);

      await expect(service.processEvent(slaBreachEvent('mod-1'))).resolves.toBeUndefined();

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('never touches Candidate — this event has no candidateId at all', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.moderator.findUnique.mockResolvedValue({ id: 'mod-1', email: 'moderator@example.com' });
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(slaBreachEvent('mod-1'));

      expect(prisma.candidate.findUnique).not.toHaveBeenCalled();
    });
  });

  // GitHub issue #704 (Phase 51, D104).
  describe('processEvent — moderation.queue.sla_warning', () => {
    it('broadcasts to every active moderator and records it', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      staffNotificationRecipients.activeModeratorEmails.mockResolvedValue([
        'mod-a@example.com',
        'admin-a@example.com',
      ]);
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(slaWarningEvent);

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'mod-a@example.com',
          subject: 'A moderation queue item is nearing its SLA deadline',
        }),
      );
      expect(mailService.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin-a@example.com' }));
      expect(prisma.notificationLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'moderation_queue',
          entityId: 'queue-1',
          eventType: 'moderation.queue.sla_warning',
          moderationQueueEntryId: '',
        },
      });
    });

    it('skips (without throwing) when there are no active moderators to notify', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);

      await expect(service.processEvent(slaWarningEvent)).resolves.toBeUndefined();

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('never sends twice for the same queue entry — idempotent against redelivery', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({ id: 'log-1' });

      await service.processEvent(slaWarningEvent);

      expect(mailService.send).not.toHaveBeenCalled();
      expect(staffNotificationRecipients.activeModeratorEmails).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('never touches Candidate — this event has no candidateId at all', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      staffNotificationRecipients.activeModeratorEmails.mockResolvedValue(['mod-a@example.com']);
      prisma.notificationLog.create.mockResolvedValue({});

      await service.processEvent(slaWarningEvent);

      expect(prisma.candidate.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage (the kafkajs entrypoint)', () => {
    // Private, but this is exactly the boundary issue #335's acceptance
    // criteria is about ("a malformed event ... logged, not silently
    // dropped or crash-looping the whole service") — accessed directly
    // rather than renamed public, since kafkajs's EachMessagePayload shape
    // has no other caller that would ever want it public.
    function handleMessage(payload: EachMessagePayload) {
      return (service as unknown as { handleMessage: (p: EachMessagePayload) => Promise<void> }).handleMessage(
        payload,
      );
    }

    const payloadFor = (value: string | null): EachMessagePayload =>
      ({
        topic: 'moderation.round_rating.created.v1',
        partition: 0,
        message: { value: value === null ? null : Buffer.from(value) },
      }) as EachMessagePayload;

    it('never throws on invalid JSON — logged and skipped, not crash-looping', async () => {
      await expect(handleMessage(payloadFor('not json'))).resolves.toBeUndefined();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('never throws on a well-formed but unrecognized event shape', async () => {
      await expect(
        handleMessage(payloadFor(JSON.stringify({ eventType: 'something.unexpected' }))),
      ).resolves.toBeUndefined();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('never throws when processEvent itself rejects (e.g. a transient SMTP error)', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.candidate.findUnique.mockResolvedValue({
        id: 'candidate-1',
        emailEncrypted: encryptFixture('candidate@example.com'),
      });
      mailService.send.mockRejectedValue(new Error('SMTP unreachable'));

      await expect(handleMessage(payloadFor(JSON.stringify(roundRatingEvent)))).resolves.toBeUndefined();
    });

    it('ignores a tombstone message (null value)', async () => {
      await expect(handleMessage(payloadFor(null))).resolves.toBeUndefined();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    // GitHub issue #489 — proves parseEvent()'s candidateId guard is
    // conditional, not a blanket requirement: a well-formed sla_breach
    // event (genuinely no candidateId field) must parse successfully,
    // not be rejected as "missing candidateId" the way #335's original
    // check would have treated it.
    it('parses and processes a well-formed sla_breach event with no candidateId at all', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.moderator.findUnique.mockResolvedValue({ id: 'mod-1', email: 'moderator@example.com' });
      prisma.notificationLog.create.mockResolvedValue({});

      await expect(handleMessage(payloadFor(JSON.stringify(slaBreachEvent('mod-1'))))).resolves.toBeUndefined();

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'moderator@example.com' }),
      );
    });
  });
});
