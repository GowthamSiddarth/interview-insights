import { createDecipheriv } from 'crypto';

// Duplicated from api/src/candidates/email-encryption.util.ts — see
// docs/DECISIONS.md D73/D74/D75. Decrypt-only: this service never writes
// Candidate.emailEncrypted, only reads and decrypts it, so encryptEmail()
// has no caller here. Must stay byte-for-byte compatible with api's
// encrypt side (same algorithm, same iv||authTag||ciphertext layout) —
// changing one without the other breaks every decrypt.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

function keyBuffer(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== 32) {
    throw new Error('EMAIL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256.');
  }
  return key;
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
