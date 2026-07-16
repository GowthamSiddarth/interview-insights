import { createHash, randomBytes } from 'crypto';

// Hashed, never store the raw token — same pattern as candidates.email_hash
// (docs/DATA_MODEL.md design principle 1). Unlike the email hash, this is
// high-entropy random input, not low-entropy guessable input, so a plain
// hash (no HMAC pepper) is sufficient — standard practice for bearer tokens.
export function generateVerificationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('hex');
  return { token, tokenHash: hashVerificationToken(token) };
}

export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
