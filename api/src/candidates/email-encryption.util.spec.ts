import { decryptEmail, encryptEmail } from './email-encryption.util';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('encryptEmail / decryptEmail', () => {
  it('round-trips back to the original email, normalized', () => {
    const encrypted = encryptEmail('Candidate@Example.com', KEY_A);
    expect(decryptEmail(encrypted, KEY_A)).toBe('candidate@example.com');
  });

  it('produces different ciphertext for the same email on each call (random IV)', () => {
    const a = encryptEmail('candidate@example.com', KEY_A);
    const b = encryptEmail('candidate@example.com', KEY_A);
    expect(a).not.toBe(b);
  });

  it('never contains the raw email as a substring', () => {
    const encrypted = encryptEmail('candidate@example.com', KEY_A);
    expect(encrypted).not.toContain('candidate');
    expect(encrypted).not.toContain('example.com');
  });

  it('fails to decrypt under the wrong key (authenticated — no silent garbage)', () => {
    const encrypted = encryptEmail('candidate@example.com', KEY_A);
    expect(() => decryptEmail(encrypted, KEY_B)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptEmail('candidate@example.com', 'too-short')).toThrow(
      'EMAIL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256.',
    );
  });
});
