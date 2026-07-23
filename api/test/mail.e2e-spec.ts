import { Test, TestingModule } from '@nestjs/testing';
import { MAIL_TRANSPORTER } from '../src/mail/mail-transporter.provider';
import { MailModule } from '../src/mail/mail.module';
import { MailService } from '../src/mail/mail.service';
import { waitForMailpitMessage } from './support/mailpit';

// Proves GitHub issue #144's acceptance criteria against a real Mailpit
// instance (kind's, via port-forward per README/wiki/deployment-guide.md,
// or docker-compose's default service) — not a mock. Mailpit is a core
// local dependency now (infra/k8s/base/08-mailpit.yaml, unconditional in
// docker-compose.yml), same standing as Postgres/OpenSearch's e2e tests:
// required to be running, no opt-in skip guard (unlike LocalStack's
// describeIfLocalStack pattern, which stays practice-only per D20).
describe('MailService (e2e, against a real Mailpit instance)', () => {
  let moduleFixture: TestingModule;
  let mailService: MailService;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [MailModule],
    }).compile();
    mailService = moduleFixture.get(MailService);
  });

  afterAll(async () => {
    // nodemailer's SMTP transport keeps a connection pool open —
    // without closing it explicitly, Jest warns about (and force-exits)
    // a worker that never tore down cleanly.
    moduleFixture.get<{ close?(): void }>(MAIL_TRANSPORTER).close?.();
    await moduleFixture.close();
  });

  it('a sent message actually lands in Mailpit, inspectable via its REST API', async () => {
    const marker = `e2e-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const to = `candidate-${marker}@example.com`;
    const subject = `Test subject ${marker}`;

    await mailService.send({ to, subject, text: `body marker ${marker}` });

    const message = await waitForMailpitMessage(to);

    expect(message.To[0].Address).toBe(to);
    expect(message.Subject).toBe(subject);
    expect(message.Snippet).toContain(marker);
  }, 15000);
});
