import { Injectable } from '@nestjs/common';
import { IpThrottle } from '../common/ip-throttle';

// A third, separate IpThrottle instance (see MagicLinkThrottleService and
// CandidateLoginThrottleService's own comments) — a throttled magic-link
// or login attempt from a shared IP shouldn't also block requesting a
// password reset, and vice versa.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

@Injectable()
export class PasswordResetThrottleService {
  private readonly throttle = new IpThrottle({
    windowMs: WINDOW_MS,
    maxAttemptsPerWindow: MAX_ATTEMPTS_PER_WINDOW,
  });

  isBlocked(ip: string): boolean {
    return this.throttle.isBlocked(ip);
  }

  recordAttempt(ip: string): void {
    this.throttle.recordAttempt(ip);
  }
}
