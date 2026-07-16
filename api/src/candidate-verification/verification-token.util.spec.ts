import { generateVerificationToken, hashVerificationToken } from './verification-token.util';

describe('verification-token.util', () => {
  it('generates a high-entropy, distinct token each call', () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();

    expect(a.token).not.toBe(b.token);
    expect(a.token).toHaveLength(64);
  });

  it('hashes the token deterministically', () => {
    const { token, tokenHash } = generateVerificationToken();

    expect(hashVerificationToken(token)).toBe(tokenHash);
  });

  it('never contains the raw token as a substring of its hash', () => {
    const { token, tokenHash } = generateVerificationToken();

    expect(tokenHash).not.toContain(token);
  });

  it('produces different hashes for different tokens', () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();

    expect(hashVerificationToken(a.token)).not.toBe(hashVerificationToken(b.token));
  });
});
