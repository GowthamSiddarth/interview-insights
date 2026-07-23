import { Test, TestingModule } from '@nestjs/testing';
import { MAIL_TRANSPORTER } from '../src/mail/mail-transporter.provider';
import { MailModule } from '../src/mail/mail.module';
import { MailService } from '../src/mail/mail.service';

// Proves GitHub issue #144's acceptance criteria against a real Mailpit
// instance (kind's, via port-forward per README/wiki/deployment-guide.md,
// or docker-compose's default service) — not a mock. Mailpit is a core
// local dependency now (infra/k8s/base/08-mailpit.yaml, unconditional in
// docker-compose.yml), same standing as Postgres/OpenSearch's e2e tests:
// required to be running, no opt-in skip guard (unlike LocalStack's
// describeIfLocalStack pattern, which stays practice-only per D20).
const MAIL_HTTP_URL = process.env.MAIL_HTTP_URL ?? 'http://localhost:8025';

interface MailpitMessage {
  From: { Address: string };
  To: { Address: string }[];
  Subject: string;
  Snippet: string;
}

interface MailpitSearchResponse {
  messages: MailpitMessage[];
}

async function searchMailpit(query: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAIL_HTTP_URL}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const body = (await res.json()) as MailpitSearchResponse;
  return body.messages;
}

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

    let messages: MailpitMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages = await searchMailpit(`to:${to}`);
      if (messages.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].To[0].Address).toBe(to);
    expect(messages[0].Subject).toBe(subject);
    expect(messages[0].Snippet).toContain(marker);
  }, 15000);
});
