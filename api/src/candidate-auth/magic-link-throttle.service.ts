import { Injectable } from '@nestjs/common';
import { IpThrottle } from '../common/ip-throttle';

// Same per-IP shape as admin-auth's LoginThrottleService (decided during
// Phase 16's kickoff brainstorm, GitHub issue #145) — a separate instance
// so an IP throttled on admin login isn't also blocked from requesting a
// candidate magic link, and vice versa.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

@Injectable()
export class MagicLinkThrottleService {
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
