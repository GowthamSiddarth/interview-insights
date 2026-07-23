import { Injectable } from '@nestjs/common';

// In-memory, per-instance IP throttle — same category of known limitation
// as fraud-checks.service.ts's full-table-scan duplicate check (D13):
// fine for today's single-instance local/kind deployment, resets on
// restart, and wouldn't coordinate across replicas. Revisit (Redis-backed)
// if this ever runs multi-replica. A simpler IP-based throttle is exactly
// what GitHub issue #159 calls for, over pulling in the DB-backed
// fraud-checks pattern, which is candidate-identity-specific.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

@Injectable()
export class LoginThrottleService {
  private readonly attempts = new Map<string, { count: number; windowStart: number }>();

  isBlocked(ip: string): boolean {
    const entry = this.attempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.windowStart >= WINDOW_MS) return false;
    return entry.count >= MAX_ATTEMPTS_PER_WINDOW;
  }

  recordAttempt(ip: string): void {
    const now = Date.now();
    const entry = this.attempts.get(ip);
    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      this.attempts.set(ip, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
  }
}
