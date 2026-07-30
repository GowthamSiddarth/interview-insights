import { createCipheriv, randomBytes } from 'crypto';
import { decryptEmail } from './email-encryption.util';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

// Independently constructed (not via this service's own decryptEmail(),
// or via api's encryptEmail() — a genuinely separate package/deploy) so
// this proves interop with the byte layout api's encrypt side produces,
// not just that decryptEmail() is self-consistent with itself.
function encryptFixture(email: string, hexKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

describe('decryptEmail', () => {
  it('decrypts a value produced by the iv||authTag||ciphertext layout api encrypts with', () => {
    const encrypted = encryptFixture('candidate@example.com', KEY_A);
    expect(decryptEmail(encrypted, KEY_A)).toBe('candidate@example.com');
  });

  it('fails under the wrong key (authenticated — no silent garbage)', () => {
    const encrypted = encryptFixture('candidate@example.com', KEY_A);
    expect(() => decryptEmail(encrypted, KEY_B)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => decryptEmail('irrelevant', 'too-short')).toThrow(
      'EMAIL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256.',
    );
  });
});
