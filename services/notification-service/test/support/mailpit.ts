// Duplicated from api/test/support/mailpit.ts — see docs/DECISIONS.md D73.
const MAIL_HTTP_URL = process.env.MAIL_HTTP_URL ?? 'http://localhost:8025';

export interface MailpitMessageSummary {
  ID: string;
  From: { Address: string };
  To: { Address: string }[];
  Subject: string;
  Snippet: string;
}

export async function searchMailpit(query: string): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${MAIL_HTTP_URL}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const body = (await res.json()) as { messages: MailpitMessageSummary[] };
  return body.messages;
}

// Polls until at least one message to `to` shows up — delivery isn't
// synchronous with the event being produced (broker round trip + this
// service's own consumer group join), so this needs a longer budget than
// api's own mail.e2e-spec.ts uses for a direct SMTP send.
export async function waitForMailpitMessage(to: string, timeoutMs = 20000): Promise<MailpitMessageSummary> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await searchMailpit(`to:${to}`);
    if (messages.length > 0) return messages[0];
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No Mailpit message found for ${to} after ${timeoutMs}ms.`);
}

// Used to prove idempotency (issue #335's own acceptance criteria): polls
// for the given window and confirms the count never exceeds `expected` —
// i.e. a redelivered event genuinely never produces a second email,
// rather than just "hadn't arrived yet" at a single check.
export async function assertMailpitMessageCountStaysAt(
  to: string,
  expected: number,
  windowMs = 5000,
): Promise<void> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const messages = await searchMailpit(`to:${to}`);
    if (messages.length > expected) {
      throw new Error(`Expected exactly ${expected} message(s) to ${to}, found ${messages.length}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}
