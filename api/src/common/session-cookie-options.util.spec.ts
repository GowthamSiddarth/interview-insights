import { getSessionCookieOptions } from './session-cookie-options.util';

describe('getSessionCookieOptions', () => {
  const originalSecure = process.env.COOKIE_SECURE;
  const originalDomain = process.env.COOKIE_DOMAIN;

  afterEach(() => {
    // Assigning `undefined` directly stringifies to the literal "undefined"
    // (process.env values are always strings) — must delete instead when
    // the original was genuinely unset, or a later test in this file sees
    // a truthy leftover value.
    if (originalSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = originalSecure;
    if (originalDomain === undefined) delete process.env.COOKIE_DOMAIN;
    else process.env.COOKIE_DOMAIN = originalDomain;
  });

  // GitHub issue #780 (Phase 52) — no silent default: COOKIE_SECURE must
  // be explicitly "true" or "false", or boot hard-fails.
  it('throws when COOKIE_SECURE is unset', () => {
    delete process.env.COOKIE_SECURE;
    expect(() => getSessionCookieOptions()).toThrow(/COOKIE_SECURE must be explicitly set/);
  });

  it('throws for any value other than the exact strings "true"/"false"', () => {
    process.env.COOKIE_SECURE = 'TRUE';
    expect(() => getSessionCookieOptions()).toThrow(/COOKIE_SECURE must be explicitly set/);
    process.env.COOKIE_SECURE = '1';
    expect(() => getSessionCookieOptions()).toThrow(/COOKIE_SECURE must be explicitly set/);
  });

  it('is not secure when COOKIE_SECURE is exactly "false"', () => {
    process.env.COOKIE_SECURE = 'false';
    expect(getSessionCookieOptions()).toEqual({ httpOnly: true, secure: false, sameSite: 'lax' });
  });

  it('is secure when COOKIE_SECURE is exactly "true"', () => {
    process.env.COOKIE_SECURE = 'true';
    expect(getSessionCookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: 'lax' });
  });

  it('defaults domain to undefined (host-only cookie) when COOKIE_DOMAIN is unset', () => {
    process.env.COOKIE_SECURE = 'false';
    delete process.env.COOKIE_DOMAIN;
    expect(getSessionCookieOptions().domain).toBeUndefined();
  });

  it('defaults domain to undefined when COOKIE_DOMAIN is an empty string', () => {
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_DOMAIN = '';
    expect(getSessionCookieOptions().domain).toBeUndefined();
  });

  it('sets domain to the shared parent domain when COOKIE_DOMAIN is set', () => {
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_DOMAIN = '.interview-insights.local';
    expect(getSessionCookieOptions().domain).toBe('.interview-insights.local');
  });
});
