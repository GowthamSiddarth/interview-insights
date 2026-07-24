import { Injectable } from '@nestjs/common';
import { IpThrottle } from '../common/ip-throttle';

// `POST /companies` has no `candidateId` to gate ownership by (a company
// isn't owned by any one candidate — CLAUDE.md's write-path discussion
// never included it), so unlike the other write paths this is purely a
// per-IP throttle layered on top of the new session requirement — defense
// in depth, not attribution. Same per-IP shape as MagicLinkThrottleService/
// LoginThrottleService — a separate instance so an IP throttled on one
// doesn't also block company creation, and vice versa.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

@Injectable()
export class CompanyCreationThrottleService {
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
