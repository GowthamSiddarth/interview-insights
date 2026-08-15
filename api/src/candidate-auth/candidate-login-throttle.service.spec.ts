import { CandidateLoginThrottleService } from './candidate-login-throttle.service';

describe('CandidateLoginThrottleService', () => {
  let service: CandidateLoginThrottleService;

  beforeEach(() => {
    service = new CandidateLoginThrottleService();
  });

  it('is not blocked before any attempt', () => {
    expect(service.isBlocked('1.2.3.4')).toBe(false);
  });

  it('is not blocked below the attempt threshold', () => {
    for (let i = 0; i < 4; i++) service.recordAttempt('1.2.3.4');
    expect(service.isBlocked('1.2.3.4')).toBe(false);
  });

  it('is blocked once the attempt threshold is reached', () => {
    for (let i = 0; i < 5; i++) service.recordAttempt('1.2.3.4');
    expect(service.isBlocked('1.2.3.4')).toBe(true);
  });

  it('tracks each IP independently', () => {
    for (let i = 0; i < 5; i++) service.recordAttempt('1.2.3.4');
    expect(service.isBlocked('1.2.3.4')).toBe(true);
    expect(service.isBlocked('5.6.7.8')).toBe(false);
  });

  it('resets the window after it expires', () => {
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;

    try {
      for (let i = 0; i < 5; i++) service.recordAttempt('1.2.3.4');
      expect(service.isBlocked('1.2.3.4')).toBe(true);

      now += 16 * 60 * 1000; // past the 15-minute window
      expect(service.isBlocked('1.2.3.4')).toBe(false);

      service.recordAttempt('1.2.3.4');
      expect(service.isBlocked('1.2.3.4')).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });
});
