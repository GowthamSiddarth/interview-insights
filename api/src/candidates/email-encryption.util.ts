import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// GitHub issue #335, D74 — the one deliberate exception to "never store
// raw email" (docs/DATA_MODEL.md design principle 1, email-hash.util.ts's
// own comment): notification-service needs an actual address to send to,
// and hashEmail()'s HMAC can never be reversed back into one. AES-256-GCM
// (authenticated, so a tampered ciphertext fails to decrypt rather than
// silently returning garbage) under a key distinct from EMAIL_HASH_SECRET
// — compromising the reversible key must never also compromise the
// irreversible one, and vice versa.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // GCM's recommended nonce length
const AUTH_TAG_LENGTH_BYTES = 16;

function keyBuffer(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) {
    throw new Error('EMAIL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256.');
  }
  return key;
}

// iv || authTag || ciphertext, base64-encoded — everything decryptEmail()
// needs is self-contained in the one stored value, no separate column for
// the nonce.
export function encryptEmail(email: string, hexKey: string): string {
  const normalized = email.trim().toLowerCase();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBuffer(hexKey), iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptEmail(encrypted: string, hexKey: string): string {
  const raw = Buffer.from(encrypted, 'base64');
  const iv = raw.subarray(0, IV_LENGTH_BYTES);
  const authTag = raw.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = raw.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const decipher = createDecipheriv(ALGORITHM, keyBuffer(hexKey), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
