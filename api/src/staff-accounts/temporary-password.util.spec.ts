import { generateTemporaryPassword } from './temporary-password.util';

describe('generateTemporaryPassword', () => {
  it('returns a non-trivial, non-deterministic string', () => {
    const a = generateTemporaryPassword();
    const b = generateTemporaryPassword();

    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThanOrEqual(20);
    expect(a).not.toBe(b);
  });
});
