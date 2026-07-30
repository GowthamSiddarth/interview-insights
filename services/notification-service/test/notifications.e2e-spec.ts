import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { MAIL_TRANSPORTER } from '../src/mail/mail-transporter.provider';
import { ROUND_RATING_CREATED_V1_TOPIC } from '../src/events/schemas/round-rating-created.event';
import { seedCandidateWithEmail } from './support/seed-candidate';
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
          entityType_entityId_eventType: {
            entityType: 'round_rating',
            entityId: roundRatingId,
            eventType: 'moderation.round_rating.created',
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
});
