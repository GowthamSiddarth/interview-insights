const MAIL_HTTP_URL = process.env.MAIL_HTTP_URL ?? 'http://localhost:8025';

export interface MailpitMessageSummary {
  ID: string;
  From: { Address: string };
  To: { Address: string }[];
  Subject: string;
  Snippet: string;
}

export interface MailpitFullMessage {
  ID: string;
  Text: string;
  HTML: string;
}

export async function searchMailpit(query: string): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${MAIL_HTTP_URL}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  const body = (await res.json()) as { messages: MailpitMessageSummary[] };
  return body.messages;
}

export async function getMailpitMessage(id: string): Promise<MailpitFullMessage> {
  const res = await fetch(`${MAIL_HTTP_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit get-message failed: ${res.status}`);
  return (await res.json()) as MailpitFullMessage;
}

// Polls until a message to `to` shows up — delivery isn't synchronous
// with the SMTP send completing.
export async function waitForMailpitMessage(to: string): Promise<MailpitMessageSummary> {
  for (let i = 0; i < 10; i++) {
    const messages = await searchMailpit(`to:${to}`);
    if (messages.length > 0) return messages[0];
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No Mailpit message found for ${to} after retrying.`);
}
