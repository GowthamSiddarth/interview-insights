import { IpThrottle } from './ip-throttle';

describe('IpThrottle', () => {
  function makeThrottle(): IpThrottle {
    return new IpThrottle({ windowMs: 15 * 60 * 1000, maxAttemptsPerWindow: 5 });
  }

  it('is not blocked before any attempt', () => {
    expect(makeThrottle().isBlocked('1.2.3.4')).toBe(false);
  });

  it('is not blocked below the attempt threshold', () => {
    const throttle = makeThrottle();
    for (let i = 0; i < 4; i++) throttle.recordAttempt('1.2.3.4');
    expect(throttle.isBlocked('1.2.3.4')).toBe(false);
  });

  it('is blocked once the attempt threshold is reached', () => {
    const throttle = makeThrottle();
    for (let i = 0; i < 5; i++) throttle.recordAttempt('1.2.3.4');
    expect(throttle.isBlocked('1.2.3.4')).toBe(true);
  });

  it('tracks each IP independently', () => {
    const throttle = makeThrottle();
    for (let i = 0; i < 5; i++) throttle.recordAttempt('1.2.3.4');
    expect(throttle.isBlocked('1.2.3.4')).toBe(true);
    expect(throttle.isBlocked('5.6.7.8')).toBe(false);
  });

  it('resets the window after it expires', () => {
    const throttle = makeThrottle();
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;

    try {
      for (let i = 0; i < 5; i++) throttle.recordAttempt('1.2.3.4');
      expect(throttle.isBlocked('1.2.3.4')).toBe(true);

      now += 16 * 60 * 1000; // past the 15-minute window
      expect(throttle.isBlocked('1.2.3.4')).toBe(false);

      throttle.recordAttempt('1.2.3.4');
      expect(throttle.isBlocked('1.2.3.4')).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it('respects independently configured windows/thresholds per instance', () => {
    const throttle = new IpThrottle({ windowMs: 60 * 1000, maxAttemptsPerWindow: 2 });
    throttle.recordAttempt('1.2.3.4');
    expect(throttle.isBlocked('1.2.3.4')).toBe(false);
    throttle.recordAttempt('1.2.3.4');
    expect(throttle.isBlocked('1.2.3.4')).toBe(true);
  });
});
