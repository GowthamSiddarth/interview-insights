import { createHmac } from 'crypto';

// Reuses the same HMAC-pepper pattern (and the same EMAIL_HASH_SECRET) as
// candidates/email-hash.util.ts — a recruiter identifier is PII-adjacent the
// same way an email is (never stored raw, only its hash, per
// docs/DATA_MODEL.md design principle 1 / CLAUDE.md hard constraint #1), and
// a second pepper just for this one field wouldn't add any real separation.
export function hashRecruiterIdentifier(identifier: string, secret: string): string {
  const normalized = identifier.trim().toLowerCase();
  return createHmac('sha256', secret).update(normalized).digest('hex');
}
