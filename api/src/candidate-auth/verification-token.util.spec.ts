import { generateVerificationToken, hashVerificationToken } from './verification-token.util';

describe('verification-token.util', () => {
  it('generates a high-entropy random token and its matching hash', () => {
    const { token, tokenHash } = generateVerificationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashVerificationToken(token));
  });

  it('generates a different token on every call', () => {
    const a = generateVerificationToken();
    const b = generateVerificationToken();
    expect(a.token).not.toBe(b.token);
  });

  it('hashes deterministically', () => {
    expect(hashVerificationToken('same-input')).toBe(hashVerificationToken('same-input'));
  });

  it('never contains the raw token as a substring of its hash', () => {
    const { token, tokenHash } = generateVerificationToken();
    expect(tokenHash).not.toContain(token);
  });
});
