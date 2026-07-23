import { getSessionCookieOptions } from './session-cookie-options.util';

describe('getSessionCookieOptions', () => {
  const original = process.env.COOKIE_SECURE;

  afterEach(() => {
    process.env.COOKIE_SECURE = original;
  });

  it('defaults secure to false when COOKIE_SECURE is unset', () => {
    delete process.env.COOKIE_SECURE;
    expect(getSessionCookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: 'lax' });
  });

  it('is not secure for any value other than the exact string "true"', () => {
    process.env.COOKIE_SECURE = 'TRUE';
    expect(getSessionCookieOptions().secure).toBe(false);
    process.env.COOKIE_SECURE = '1';
    expect(getSessionCookieOptions().secure).toBe(false);
  });

  it('is secure when COOKIE_SECURE is exactly "true"', () => {
    process.env.COOKIE_SECURE = 'true';
    expect(getSessionCookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: 'lax' });
  });
});
