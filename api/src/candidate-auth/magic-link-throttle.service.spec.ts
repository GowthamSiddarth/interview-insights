import { MagicLinkThrottleService } from './magic-link-throttle.service';

describe('MagicLinkThrottleService', () => {
  let service: MagicLinkThrottleService;

  beforeEach(() => {
    service = new MagicLinkThrottleService();
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
});
