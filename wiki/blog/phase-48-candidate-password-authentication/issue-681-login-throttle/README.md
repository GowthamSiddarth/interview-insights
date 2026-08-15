# Phase 48, Issue #681 — Candidate Password Login + CandidateLoginThrottleGuard

*Part of Phase 48 — Candidate Password Authentication.
See `docs/ROADMAP.md` Phase 48, D104.*

## A near-direct port of admin-auth's login pattern

`POST /auth/login` mirrors `AdminAuthController.login()`/
`AdminAuthService.validateAdmin()` closely enough that most of the work
was making sure the port stayed faithful rather than inventing anything
new:

```ts
async login(email: string, password: string): Promise<CandidateSessionPayload> {
  const emailHash = hashEmail(email, getEmailHashSecret());
  const candidate = await this.prisma.candidate.findUnique({ where: { emailHash } });
  if (!candidate?.passwordHash) {
    throw new UnauthorizedException('Invalid email or password.');
  }

  const matches = await bcrypt.compare(password, candidate.passwordHash);
  if (!matches) {
    throw new UnauthorizedException('Invalid email or password.');
  }

  return { candidateId: candidate.id, tokenVersion: candidate.tokenVersion };
}
```

The same generic message — "Invalid email or password." — covers three
distinct cases: an unknown email, a candidate who's never set a password
(magic-link-only), and a wrong password. Distinguishing them in the
response would let an attacker enumerate which emails have accounts here,
the same enumeration-safety reasoning `requestLink()` and
`requestPasswordReset()` already apply.

## A third independent throttle instance, not a shared one

`CandidateLoginThrottleGuard`/`Service` are new, not a reuse of
`MagicLinkThrottleService` or `AdminAuthModule`'s `LoginThrottleService` —
same `IpThrottle` core (5 attempts per 15-minute window per IP), but a
separate counter:

```ts
@Injectable()
export class CandidateLoginThrottleService {
  private readonly throttle = new IpThrottle({ windowMs: WINDOW_MS, maxAttemptsPerWindow: MAX_ATTEMPTS_PER_WINDOW });
  // ...
}
```

The reasoning is the same one that already justified
`MagicLinkThrottleService` being separate from admin-auth's own: a
throttled admin login attempt from a shared office/NAT IP shouldn't also
lock out candidate logins from that IP, and vice versa. Three unrelated
abuse surfaces, three independent counters.

The guard runs before the handler in `@UseGuards()`'s array order, so a
throttled IP never reaches the `bcrypt.compare()` call — bcrypt is
deliberately slow, and letting a throttled attacker keep triggering it
anyway would be a mild DoS surface in its own right.

## Verification

Unit tests for the login happy path and all three rejection cases
(wrong password, unknown email, magic-link-only account), plus dedicated
specs for the new guard and service (mirroring `login-throttle.guard.spec.ts`/
`login-throttle.service.spec.ts` almost line for line). Real-Postgres e2e
coverage: login starts a session; each rejection case gets its own 401
test; a rate-limit test fires 5 failed attempts and confirms the 6th
(even with the *correct* password) still 429s — proving the throttle
gates on IP and attempt count, not success/failure of the credentials
themselves.
