export interface IpThrottleOptions {
  windowMs: number;
  maxAttemptsPerWindow: number;
}

// Shared in-memory per-IP throttle core — used by both admin login
// (admin-auth/login-throttle.service.ts) and the candidate magic-link
// request endpoint (candidate-auth/magic-link-throttle.service.ts), so a
// future change to the counting logic itself doesn't have to be made
// twice and risk silently diverging (GitHub issue #145's brainstorm
// applied the same reasoning to the shared cookie-options helper).
// Same known limitation as fraud-checks.service.ts's full-table-scan
// check (D13): fine for today's single-instance deployment, resets on
// restart, wouldn't coordinate across replicas — revisit if this ever
// runs multi-replica.
export class IpThrottle {
  private readonly attempts = new Map<string, { count: number; windowStart: number }>();

  constructor(private readonly options: IpThrottleOptions) {}

  isBlocked(ip: string): boolean {
    const entry = this.attempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.windowStart >= this.options.windowMs) return false;
    return entry.count >= this.options.maxAttemptsPerWindow;
  }

  recordAttempt(ip: string): void {
    const now = Date.now();
    const entry = this.attempts.get(ip);
    if (!entry || now - entry.windowStart >= this.options.windowMs) {
      this.attempts.set(ip, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
  }
}
