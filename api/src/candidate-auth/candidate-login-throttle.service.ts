import { Injectable } from '@nestjs/common';
import { IpThrottle } from '../common/ip-throttle';

// Mirrors admin-auth/login-throttle.service.ts — same window/limits, a
// separate instance so a throttled admin login attempt doesn't also
// throttle candidate logins from the same IP (a shared office/NAT IP
// shouldn't have one auth surface's abuse lock out the other).
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

@Injectable()
export class CandidateLoginThrottleService {
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
