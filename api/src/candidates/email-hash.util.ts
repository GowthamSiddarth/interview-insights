import { createHmac } from 'crypto';

// Never store or log the raw email — only this hash, per docs/DATA_MODEL.md
// design principle 1. HMAC (not a bare hash) so the value can't be reversed
// via a rainbow table without the server-side secret.
export function hashEmail(email: string, secret: string): string {
  const normalized = email.trim().toLowerCase();
  return createHmac('sha256', secret).update(normalized).digest('hex');
}
