import { EditThrottleService } from './edit-throttle.service';

describe('EditThrottleService', () => {
  let service: EditThrottleService;

  beforeEach(() => {
    service = new EditThrottleService();
  });

  it('is not blocked before any attempt', () => {
    expect(service.isBlocked('candidate-1')).toBe(false);
  });

  it('is not blocked below the attempt threshold', () => {
    for (let i = 0; i < 4; i++) service.recordAttempt('candidate-1');
    expect(service.isBlocked('candidate-1')).toBe(false);
  });

  it('is blocked once the attempt threshold is reached', () => {
    for (let i = 0; i < 5; i++) service.recordAttempt('candidate-1');
    expect(service.isBlocked('candidate-1')).toBe(true);
  });

  it('tracks each candidate independently', () => {
    for (let i = 0; i < 5; i++) service.recordAttempt('candidate-1');
    expect(service.isBlocked('candidate-1')).toBe(true);
    expect(service.isBlocked('candidate-2')).toBe(false);
  });

  it('resets the window after it expires', () => {
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;

    try {
      for (let i = 0; i < 5; i++) service.recordAttempt('candidate-1');
      expect(service.isBlocked('candidate-1')).toBe(true);

      now += 61 * 60 * 1000; // past the 60-minute window
      expect(service.isBlocked('candidate-1')).toBe(false);

      service.recordAttempt('candidate-1');
      expect(service.isBlocked('candidate-1')).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });
});
