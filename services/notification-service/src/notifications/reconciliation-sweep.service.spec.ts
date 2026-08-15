import { createCipheriv, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { ReconciliationSweepService } from './reconciliation-sweep.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const ENCRYPTION_KEY = 'a'.repeat(64);

function encryptFixture(email: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

// GitHub issue #711 (Phase 49, D104) — mirrors review-analyzer's own
// ReconciliationSweepService.spec.ts shape: a periodic sweep closing the
// "lost/never-processed event" gap without a transactional outbox.
describe('ReconciliationSweepService', () => {
  const originalKey = process.env.EMAIL_ENCRYPTION_KEY;

  let prisma: {
    moderationQueueEntry: { findMany: jest.Mock };
    roundRating: { findUnique: jest.Mock };
    recruiterRating: { findUnique: jest.Mock };
    overallReview: { findUnique: jest.Mock };
    candidate: { findUnique: jest.Mock };
    notificationLog: { findUnique: jest.Mock; create: jest.Mock };
  };
  let mailService: { send: jest.Mock };

  beforeEach(() => {
    process.env.EMAIL_ENCRYPTION_KEY = ENCRYPTION_KEY;
    prisma = {
      moderationQueueEntry: { findMany: jest.fn().mockResolvedValue([]) },
      roundRating: { findUnique: jest.fn() },
      recruiterRating: { findUnique: jest.fn() },
      overallReview: { findUnique: jest.fn() },
      candidate: { findUnique: jest.fn() },
      notificationLog: { findUnique: jest.fn(), create: jest.fn().mockResolvedValue({}) },
    };
    mailService = { send: jest.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => {
    process.env.EMAIL_ENCRYPTION_KEY = originalKey;
  });

  function buildService(): ReconciliationSweepService {
    return new ReconciliationSweepService(prisma as unknown as PrismaService, mailService as unknown as MailService);
  }

  describe('sweep', () => {
    it('queries only reviewed, stale moderation_queue entries', async () => {
      const service = buildService();

      await service.sweep();

      expect(prisma.moderationQueueEntry.findMany).toHaveBeenCalledWith({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is typed `any` by @types/jest
        where: { reviewedAt: { not: null, lt: expect.any(Date) } },
      });
    });

    it('reconciles every stale entry returned', async () => {
      prisma.moderationQueueEntry.findMany.mockResolvedValue([
        { id: 'queue-1', entityType: 'round_rating', entityId: 'rating-1' },
        { id: 'queue-2', entityType: 'overall_review', entityId: 'review-1' },
      ]);
      prisma.notificationLog.findUnique.mockResolvedValue({ id: 'already-logged' });
      const service = buildService();

      await service.sweep();

      expect(prisma.roundRating.findUnique).not.toHaveBeenCalled(); // short-circuited by the alreadySent check
      expect(prisma.notificationLog.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('reconcileOne', () => {
    it('is a no-op for a company entry — never notification-worthy', async () => {
      const service = buildService();

      await service.reconcileOne('queue-1', 'company', 'company-1');

      expect(prisma.notificationLog.findUnique).not.toHaveBeenCalled();
    });

    it('is a no-op when a notification was already sent for this exact queue entry', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue({ id: 'log-1' });
      const service = buildService();

      await service.reconcileOne('queue-1', 'round_rating', 'rating-1');

      expect(prisma.roundRating.findUnique).not.toHaveBeenCalled();
      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('looks up the dedup key scoped to the queue entry', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.roundRating.findUnique.mockResolvedValue({ candidateId: 'candidate-1', status: 'approved' });
      prisma.candidate.findUnique.mockResolvedValue({ emailEncrypted: encryptFixture('candidate@example.com') });
      const service = buildService();

      await service.reconcileOne('queue-1', 'round_rating', 'rating-1');

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

    it('sends the missed approved email and records it', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.roundRating.findUnique.mockResolvedValue({ candidateId: 'candidate-1', status: 'approved' });
      prisma.candidate.findUnique.mockResolvedValue({ emailEncrypted: encryptFixture('candidate@example.com') });
      const service = buildService();

      await service.reconcileOne('queue-1', 'round_rating', 'rating-1');

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

    it('sends the missed rejected email for a recruiter_rating', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.recruiterRating.findUnique.mockResolvedValue({ candidateId: 'candidate-1', status: 'rejected' });
      prisma.candidate.findUnique.mockResolvedValue({ emailEncrypted: encryptFixture('candidate@example.com') });
      const service = buildService();

      await service.reconcileOne('queue-1', 'recruiter_rating', 'rating-2');

      expect(mailService.send).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Your submission was not approved' }),
      );
    });

    it('is a no-op for an overall_review still pending (no decision to notify about yet)', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.overallReview.findUnique.mockResolvedValue({ candidateId: 'candidate-1', status: 'pending' });
      const service = buildService();

      await service.reconcileOne('queue-1', 'overall_review', 'review-1');

      expect(mailService.send).not.toHaveBeenCalled();
      expect(prisma.notificationLog.create).not.toHaveBeenCalled();
    });

    it('is a no-op for a flagged entity — never notification-worthy, same as the live consumer path', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.roundRating.findUnique.mockResolvedValue({ candidateId: 'candidate-1', status: 'flagged' });
      const service = buildService();

      await service.reconcileOne('queue-1', 'round_rating', 'rating-1');

      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('is a no-op when the entity no longer exists', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.roundRating.findUnique.mockResolvedValue(null);
      const service = buildService();

      await service.reconcileOne('queue-1', 'round_rating', 'rating-1');

      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('skips (without throwing) when the candidate has no email on file', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.roundRating.findUnique.mockResolvedValue({ candidateId: 'candidate-1', status: 'approved' });
      prisma.candidate.findUnique.mockResolvedValue({ emailEncrypted: null });
      const service = buildService();

      await expect(service.reconcileOne('queue-1', 'round_rating', 'rating-1')).resolves.toBeUndefined();

      expect(mailService.send).not.toHaveBeenCalled();
    });

    it('swallows a unique-constraint race on the final record', async () => {
      prisma.notificationLog.findUnique.mockResolvedValue(null);
      prisma.roundRating.findUnique.mockResolvedValue({ candidateId: 'candidate-1', status: 'approved' });
      prisma.candidate.findUnique.mockResolvedValue({ emailEncrypted: encryptFixture('candidate@example.com') });
      const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.notificationLog.create.mockRejectedValue(conflict);
      const service = buildService();

      await expect(service.reconcileOne('queue-1', 'round_rating', 'rating-1')).resolves.toBeUndefined();
      expect(mailService.send).toHaveBeenCalled();
    });
  });
});
