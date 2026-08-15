import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAIL_TRANSPORTER } from '../src/mail/mail-transporter.provider';
import { ROUND_RATING_CREATED_V1_TOPIC } from '../src/events/schemas/round-rating-created.event';
import { ROUND_RATING_STATUS_CHANGED_V1_TOPIC } from '../src/events/schemas/round-rating-status-changed.event';
import { COMPANY_CREATED_V1_TOPIC } from '../src/events/schemas/company-created.event';
import { COMPANY_STATUS_CHANGED_V1_TOPIC } from '../src/events/schemas/company-status-changed.event';
import { MODERATION_QUEUE_SLA_BREACH_V1_TOPIC } from '../src/events/schemas/moderation-queue-sla-breach.event';
import { STAFF_ACCOUNT_CREATED_V1_TOPIC } from '../src/events/schemas/staff-account-created.event';
import { seedCandidateWithEmail } from './support/seed-candidate';
import { seedModeratorWithEmail } from './support/seed-moderator';
import { publishTestEvent } from './support/redpanda-producer';
import { assertMailpitMessageCountStaysAt, searchMailpit, waitForMailpitMessage } from './support/mailpit';

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Proves GitHub issue #335's acceptance criteria end to end against real
// infrastructure (Redpanda, Postgres, Mailpit) — same "needs a real
// instance, not a mock" standing as api/test/mail.e2e-spec.ts (D29) and
// api/test/domain-events.e2e-spec.ts. Stands in for "a candidate submits
// a rating for real" by seeding a candidate row directly and publishing
// the same event shape/topic api's real write path would (see
// test/support/seed-candidate.ts and redpanda-producer.ts's own
// comments for why this service's own CI job doesn't run api itself).
describe('NotificationConsumerService (e2e, against real Redpanda/Postgres/Mailpit)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Same nodemailer connection-pool teardown as api/test/mail.e2e-spec.ts.
    app.get<{ close?(): void }>(MAIL_TRANSPORTER).close?.();
    await app.close();
  });

  it(
    'a real moderation.round_rating.created.v1 event results in a pending-review email landing in Mailpit, and a redelivery of the same event never sends a second one',
    async () => {
      const marker = unique();
      const email = `candidate-${marker}@example.com`;
      const candidateId = await seedCandidateWithEmail(prisma, email);
      // A real RoundRating.id is a Prisma @default(uuid()) — entity_id in
      // notification_log is @db.Uuid, so this has to be a genuine UUID,
      // not just any unique string.
      const roundRatingId = randomUUID();

      const event = {
        eventType: 'moderation.round_rating.created' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        roundRatingId,
        roundId: randomUUID(),
        candidateId,
        companyId: randomUUID(),
        status: 'pending' as const,
      };

      await publishTestEvent(ROUND_RATING_CREATED_V1_TOPIC, event, roundRatingId);

      const message = await waitForMailpitMessage(email);
      expect(message.To[0].Address).toBe(email);
      expect(message.Subject).toBe('Your submission is pending review');

      const logged = await prisma.notificationLog.findUnique({
        where: {
          notification_log_dedup_key: {
            entityType: 'round_rating',
            entityId: roundRatingId,
            eventType: 'moderation.round_rating.created',
            moderationQueueEntryId: '',
          },
        },
      });
      expect(logged).not.toBeNull();

      // Redelivery: at-least-once means Redpanda can (and, per the
      // acceptance criteria, must be assumed to) redeliver the exact same
      // message. This must never result in a second email.
      await publishTestEvent(ROUND_RATING_CREATED_V1_TOPIC, event, roundRatingId);
      await assertMailpitMessageCountStaysAt(email, 1);

      const messagesForRecipient = await searchMailpit(`to:${email}`);
      expect(messagesForRecipient).toHaveLength(1);
    },
    25000,
  );

  // GitHub issue #692 (Phase 49, D104) — a resubmission fires the same
  // *.created event shape a second time for the same roundRatingId; this
  // must land a distinct "back in review" email, not be swallowed as an
  // already-notified duplicate of the original submission's email above.
  it(
    'a resubmission created.v1 event (isResubmission: true) sends a distinct email, deduped separately from the original submission',
    async () => {
      const marker = unique();
      const email = `candidate-${marker}@example.com`;
      const candidateId = await seedCandidateWithEmail(prisma, email);
      const roundRatingId = randomUUID();
      const resubmissionQueueEntryId = randomUUID();

      const originalEvent = {
        eventType: 'moderation.round_rating.created' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        roundRatingId,
        roundId: randomUUID(),
        candidateId,
        companyId: randomUUID(),
        status: 'pending' as const,
      };
      await publishTestEvent(ROUND_RATING_CREATED_V1_TOPIC, originalEvent, roundRatingId);
      await waitForMailpitMessage(email);

      const resubmissionEvent = {
        ...originalEvent,
        occurredAt: new Date().toISOString(),
        isResubmission: true,
        moderationQueueEntryId: resubmissionQueueEntryId,
      };
      await publishTestEvent(ROUND_RATING_CREATED_V1_TOPIC, resubmissionEvent, roundRatingId);

      // Poll until the second (resubmission) email actually lands —
      // waitForMailpitMessage() alone would just re-return the first
      // message already found by the original-submission check above.
      const deadline = Date.now() + 20000;
      let messages: Awaited<ReturnType<typeof searchMailpit>> = [];
      while (Date.now() < deadline) {
        messages = await searchMailpit(`to:${email}`);
        if (messages.length >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(messages).toHaveLength(2);
      const resubmissionMessage = messages.find((m) => m.Subject === 'Your edited submission is back in review');
      expect(resubmissionMessage).toBeDefined();

      const logged = await prisma.notificationLog.findUnique({
        where: {
          notification_log_dedup_key: {
            entityType: 'round_rating',
            entityId: roundRatingId,
            eventType: 'moderation.round_rating.created',
            moderationQueueEntryId: resubmissionQueueEntryId,
          },
        },
      });
      expect(logged).not.toBeNull();

      // Redelivery of the resubmission event must never send a second copy.
      await publishTestEvent(ROUND_RATING_CREATED_V1_TOPIC, resubmissionEvent, roundRatingId);
      await assertMailpitMessageCountStaysAt(email, 2);
    },
    25000,
  );

  // GitHub issue #698 (Phase 50, D104) — company reuses every consumer
  // code path the other three entity types already exercise above;
  // proven directly against real Redpanda/Postgres/Mailpit rather than
  // just inferred from unit coverage.
  it(
    'a real moderation.company.created.v1 event results in a pending-review email, and moderation.company.status_changed.v1 results in an approval email',
    async () => {
      const marker = unique();
      const email = `candidate-${marker}@example.com`;
      const candidateId = await seedCandidateWithEmail(prisma, email);
      const companyId = randomUUID();
      const moderationQueueEntryId = randomUUID();

      const createdEvent = {
        eventType: 'moderation.company.created' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        companyId,
        candidateId,
        status: 'pending' as const,
      };
      await publishTestEvent(COMPANY_CREATED_V1_TOPIC, createdEvent, companyId);

      const pendingMessage = await waitForMailpitMessage(email);
      expect(pendingMessage.Subject).toBe('Your submission is pending review');

      const loggedCreated = await prisma.notificationLog.findUnique({
        where: {
          notification_log_dedup_key: {
            entityType: 'company',
            entityId: companyId,
            eventType: 'moderation.company.created',
            moderationQueueEntryId: '',
          },
        },
      });
      expect(loggedCreated).not.toBeNull();

      const statusChangedEvent = {
        eventType: 'moderation.company.status_changed' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        companyId,
        candidateId,
        previousStatus: 'pending' as const,
        newStatus: 'approved' as const,
        moderationQueueEntryId,
      };
      await publishTestEvent(COMPANY_STATUS_CHANGED_V1_TOPIC, statusChangedEvent, companyId);

      const deadline = Date.now() + 20000;
      let messages: Awaited<ReturnType<typeof searchMailpit>> = [];
      while (Date.now() < deadline) {
        messages = await searchMailpit(`to:${email}`);
        if (messages.length >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      expect(messages).toHaveLength(2);
      const approvalMessage = messages.find((m) => m.Subject === 'Your submission has been approved');
      expect(approvalMessage).toBeDefined();
    },
    25000,
  );

  // GitHub issue #336 — same idempotent-consumer shape as #335's test
  // above, proven against the status_changed side instead.
  it(
    'a real moderation.round_rating.status_changed.v1 event (newStatus: approved) results in an approval email, and redelivery never sends a second one',
    async () => {
      const marker = unique();
      const email = `candidate-${marker}@example.com`;
      const candidateId = await seedCandidateWithEmail(prisma, email);
      const roundRatingId = randomUUID();
      const moderationQueueEntryId = randomUUID();

      const event = {
        eventType: 'moderation.round_rating.status_changed' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        roundRatingId,
        roundId: randomUUID(),
        candidateId,
        companyId: randomUUID(),
        previousStatus: 'pending' as const,
        newStatus: 'approved' as const,
        moderationQueueEntryId,
      };

      await publishTestEvent(ROUND_RATING_STATUS_CHANGED_V1_TOPIC, event, roundRatingId);

      const message = await waitForMailpitMessage(email);
      expect(message.To[0].Address).toBe(email);
      expect(message.Subject).toBe('Your submission has been approved');

      const logged = await prisma.notificationLog.findUnique({
        where: {
          notification_log_dedup_key: {
            entityType: 'round_rating',
            entityId: roundRatingId,
            eventType: 'moderation.round_rating.status_changed',
            moderationQueueEntryId,
          },
        },
      });
      expect(logged).not.toBeNull();

      await publishTestEvent(ROUND_RATING_STATUS_CHANGED_V1_TOPIC, event, roundRatingId);
      await assertMailpitMessageCountStaysAt(email, 1);

      const messagesForRecipient = await searchMailpit(`to:${email}`);
      expect(messagesForRecipient).toHaveLength(1);
    },
    25000,
  );

  // GitHub issue #687 (Phase 49, D104) — the confirmed-bug fix, proven
  // against the real broker/Postgres/Mailpit: a candidate who edits a
  // rejected entity gets re-enqueued into a *different* moderation_queue
  // row for the same underlying entityId (reenqueue()). Before this fix,
  // the second decision's status_changed event would have been silently
  // deduped against the first (same entityType+entityId+eventType), and
  // the candidate would never learn their resubmission was reviewed.
  it(
    'two status_changed decisions on the same entity from different moderation_queue entries (a resubmission) both send an email',
    async () => {
      const marker = unique();
      const email = `candidate-${marker}@example.com`;
      const candidateId = await seedCandidateWithEmail(prisma, email);
      const roundRatingId = randomUUID();

      const firstDecision = {
        eventType: 'moderation.round_rating.status_changed' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        roundRatingId,
        roundId: randomUUID(),
        candidateId,
        companyId: randomUUID(),
        previousStatus: 'pending' as const,
        newStatus: 'rejected' as const,
        moderationQueueEntryId: randomUUID(),
      };
      await publishTestEvent(ROUND_RATING_STATUS_CHANGED_V1_TOPIC, firstDecision, roundRatingId);
      await waitForMailpitMessage(email);

      // A resubmission: same entity, a genuinely different
      // moderation_queue entry, a different decision.
      const secondDecision = { ...firstDecision, newStatus: 'approved' as const, moderationQueueEntryId: randomUUID() };
      await publishTestEvent(ROUND_RATING_STATUS_CHANGED_V1_TOPIC, secondDecision, roundRatingId);

      await assertMailpitMessageCountStaysAt(email, 2);
      const messagesForRecipient = await searchMailpit(`to:${email}`);
      expect(messagesForRecipient).toHaveLength(2);
      expect(messagesForRecipient.map((m) => m.Subject).sort()).toEqual([
        'Your submission has been approved',
        'Your submission was not approved',
      ]);
    },
    25000,
  );

  // 'flagged' is the one newStatus this consumer deliberately never emails
  // for (see notification-consumer.service.ts's notificationFor()) —
  // proven here against the real broker so a future change to that
  // no-op can't silently start sending a "flagged" email.
  it(
    'a real moderation.round_rating.status_changed.v1 event (newStatus: flagged) never sends an email',
    async () => {
      const marker = unique();
      const email = `candidate-${marker}@example.com`;
      const candidateId = await seedCandidateWithEmail(prisma, email);
      const roundRatingId = randomUUID();

      const event = {
        eventType: 'moderation.round_rating.status_changed' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        roundRatingId,
        roundId: randomUUID(),
        candidateId,
        companyId: randomUUID(),
        previousStatus: 'pending' as const,
        newStatus: 'flagged' as const,
      };

      await publishTestEvent(ROUND_RATING_STATUS_CHANGED_V1_TOPIC, event, roundRatingId);

      await assertMailpitMessageCountStaysAt(email, 0);
      expect(await searchMailpit(`to:${email}`)).toHaveLength(0);
    },
    25000,
  );

  // GitHub issue #489 (Phase 36) — same real-broker/real-Postgres/real-
  // Mailpit standing as the tests above, proven against the structurally
  // different sla_breach event instead: no candidateId, recipient
  // resolved via claimedById -> Moderator.email.
  it(
    'a real moderation.queue.sla_breach.v1 event with a claimant results in an overdue email, and redelivery never sends a second one',
    async () => {
      const marker = unique();
      const email = `moderator-${marker}@example.com`;
      const moderatorId = await seedModeratorWithEmail(prisma, email);
      const queueEntryId = randomUUID();

      const event = {
        eventType: 'moderation.queue.sla_breach' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        queueEntryId,
        entityType: 'round_rating',
        entityId: randomUUID(),
        slaDeadline: new Date(Date.now() - 60_000).toISOString(),
        claimedById: moderatorId,
      };

      await publishTestEvent(MODERATION_QUEUE_SLA_BREACH_V1_TOPIC, event, queueEntryId);

      const message = await waitForMailpitMessage(email);
      expect(message.To[0].Address).toBe(email);
      expect(message.Subject).toBe('A moderation queue item you claimed is overdue');

      const logged = await prisma.notificationLog.findUnique({
        where: {
          notification_log_dedup_key: {
            entityType: 'moderation_queue',
            entityId: queueEntryId,
            eventType: 'moderation.queue.sla_breach',
            moderationQueueEntryId: '',
          },
        },
      });
      expect(logged).not.toBeNull();

      await publishTestEvent(MODERATION_QUEUE_SLA_BREACH_V1_TOPIC, event, queueEntryId);
      await assertMailpitMessageCountStaysAt(email, 1);

      const messagesForRecipient = await searchMailpit(`to:${email}`);
      expect(messagesForRecipient).toHaveLength(1);
    },
    25000,
  );

  // GitHub issue #704 (Phase 51, D104) — no auto-assignment under this
  // phase's manual-claim-only model (D80) still means an unclaimed
  // breach has no *claimant*, but it's no longer a silent no-op: it now
  // escalates to every active admin instead. This test used to assert
  // the pre-#704 "never sends an email" behavior; it's now the opposite,
  // proven against the real broker/Postgres/Mailpit stack.
  it(
    'a real moderation.queue.sla_breach.v1 event with no claimant escalates to every active admin',
    async () => {
      const adminEmail = `admin-${unique()}@example.com`;
      await seedModeratorWithEmail(prisma, adminEmail, 'admin');
      // A plain moderator must never receive the escalation — only admins.
      await seedModeratorWithEmail(prisma, `mod-${unique()}@example.com`, 'moderator');
      const queueEntryId = randomUUID();
      const event = {
        eventType: 'moderation.queue.sla_breach' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        queueEntryId,
        entityType: 'overall_review',
        entityId: randomUUID(),
        slaDeadline: new Date(Date.now() - 60_000).toISOString(),
        claimedById: null,
      };

      await publishTestEvent(MODERATION_QUEUE_SLA_BREACH_V1_TOPIC, event, queueEntryId);

      const message = await waitForMailpitMessage(adminEmail);
      expect(message.Subject).toBe('A moderation queue item you claimed is overdue');

      const logged = await prisma.notificationLog.findUnique({
        where: {
          notification_log_dedup_key: {
            entityType: 'moderation_queue',
            entityId: queueEntryId,
            eventType: 'moderation.queue.sla_breach',
            moderationQueueEntryId: '',
          },
        },
      });
      expect(logged).not.toBeNull();
    },
    25000,
  );

  it(
    'a real moderation.queue.sla_breach.v1 event with no claimant and no active admins never sends an email',
    async () => {
      const queueEntryId = randomUUID();
      const event = {
        eventType: 'moderation.queue.sla_breach' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        queueEntryId,
        entityType: 'overall_review',
        entityId: randomUUID(),
        slaDeadline: new Date(Date.now() - 60_000).toISOString(),
        claimedById: null,
      };

      await publishTestEvent(MODERATION_QUEUE_SLA_BREACH_V1_TOPIC, event, queueEntryId);

      // No candidate/moderator email to search Mailpit by here — instead,
      // confirm no NotificationLog row was ever written, which is the
      // real signal this path was a no-op (same "wait a beat, then
      // assert" shape assertMailpitMessageCountStaysAt uses elsewhere).
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const logged = await prisma.notificationLog.findUnique({
        where: {
          notification_log_dedup_key: {
            entityType: 'moderation_queue',
            entityId: queueEntryId,
            eventType: 'moderation.queue.sla_breach',
            moderationQueueEntryId: '',
          },
        },
      });
      expect(logged).toBeNull();
    },
    25000,
  );

  // GitHub issue #705 (Phase 51, D104) — the recipient email is already
  // on the event (StaffAccountsService had it in hand at publish time,
  // #702), so unlike every other e2e case in this file, this one needs
  // no seeded Candidate/Moderator row at all.
  it(
    'a real staff.account.created.v1 event sends the new account its temporary password',
    async () => {
      const email = `new-staff-${unique()}@example.com`;
      const moderatorId = randomUUID();
      const event = {
        eventType: 'staff.account.created' as const,
        eventVersion: 1 as const,
        occurredAt: new Date().toISOString(),
        moderatorId,
        email,
        role: 'moderator' as const,
        actorId: randomUUID(),
        temporaryPassword: 'e2e-temp-password',
        actionId: randomUUID(),
      };

      await publishTestEvent(STAFF_ACCOUNT_CREATED_V1_TOPIC, event, moderatorId);

      const message = await waitForMailpitMessage(email);
      expect(message.Subject).toBe('Your staff account has been created');

      const logged = await prisma.notificationLog.findUnique({
        where: {
          notification_log_dedup_key: {
            entityType: 'staff_account',
            entityId: moderatorId,
            eventType: 'staff.account.created',
            moderationQueueEntryId: event.actionId,
          },
        },
      });
      expect(logged).not.toBeNull();
    },
    25000,
  );
});
