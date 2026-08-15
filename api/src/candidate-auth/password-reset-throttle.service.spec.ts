import { PasswordResetThrottleService } from './password-reset-throttle.service';

describe('PasswordResetThrottleService', () => {
  let service: PasswordResetThrottleService;

  beforeEach(() => {
    service = new PasswordResetThrottleService();
  });

  it('is not blocked before any attempt', () => {
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
});
