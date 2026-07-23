# Phase 18, Issue #159 — Admin Auth Backend

*Part of Phase 18 — Admin Authentication. See `docs/ROADMAP.md` Phase 18.*

## Why this jumped the queue

Phase 18 was numbered after Phases 16 and 17 in the planning pass, but
was deliberately implemented first — the same non-linear precedent
Phase 6/8 already set (a later-numbered phase proceeding while an
earlier one sits open). The trigger was a strategic infra/security
review that asked a simple question with an uncomfortable answer: what
happens to `ModerationController` — the surface that approves, rejects,
and flags every rating and review on the platform — the moment any
environment becomes reachable by someone other than its one developer?
Both `ModerationController` and `web/src/app/moderation/page.tsx` said
so directly in their own code comments: no authentication existed.
That had been a reasonable trust model exactly as long as everything
stayed on localhost/kind. It stops being reasonable the instant a real
staging box or even a shared demo link exists — and this project had
just spent Phases 10–13 building toward exactly that. Urgent, small,
and blocking anything else from being safely exposed: the definition of
"do this before the already-planned work."

## Key concept: one shared credential, not a user table

The scope note in the issue is as important as the code: this is
deliberately *not* a multi-user/RBAC system. There is exactly one
moderator today — the project owner. Building role management ahead of
a second admin existing would be the textbook case of designing for a
requirement that doesn't exist yet, which this project's own
conventions explicitly warn against. So the credential is a single
`ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` pair, following the same
plain-env-var pattern `EMAIL_HASH_SECRET` has used since Phase 2 (a
dev k8s Secret locally; not wired into the Phase 11 LocalStack secrets
bootstrap, which stays scoped to `DATABASE_URL`/`EMAIL_HASH_SECRET`
only — extending it here would be scope creep this issue didn't ask
for). If a second admin is ever needed, that's the moment to revisit
this — not before.

## Key concept: the session lives in an httpOnly cookie, never in JS

`POST /auth/admin/login` verifies the credential and returns a
short-lived (1h) JWT — but never in the JSON body. It's set as an
httpOnly `admin_session` cookie instead, so `web`'s client-side
JavaScript never has the raw token to leak via an XSS bug, a stray
`console.log`, or a browser extension. `AdminJwtAuthGuard`, applied at
the controller level on `ModerationController`, reads that cookie via
a `passport-jwt` strategy and 401s on anything missing, malformed, or
expired — `AuthGuard`'s default `handleRequest` already does exactly
that, so no custom override was needed.

This has a real corollary on the client side that didn't fully surface
until issue #160 wired up the login page: cookies aren't sent
cross-origin by default. `enableCors({ credentials: true })` on the API
is necessary but not sufficient — the browser's `fetch()` call also has
to opt in with `credentials: 'include'`, or the cookie never leaves the
browser at all. Documented here because it's the kind of gap that looks
fine in isolation (the endpoint tests pass; curl with `-b`/`-c` works
fine) and only breaks once a real browser, on a different origin, tries
to use it — the actual bug this project's Playwright-verification habit
exists to catch.

## Key concept: throttle before the expensive comparison

Login is a new attack surface the moment it exists, so it's
rate-limited: a new `LoginThrottleService`, in-memory and per-IP (5
attempts / 15 minutes) — deliberately simpler than Phase 3's
`FraudChecksService`, which is candidate-identity-specific and DB-backed
for a different reason. The ordering matters more than it looks:
`@UseGuards(LoginThrottleGuard, AdminLocalAuthGuard)` runs the throttle
check *before* the credential check, so a throttled IP never reaches
`bcrypt.compare()` at all. bcrypt is deliberately slow — that's the
whole point of using it — which makes "let an attacker keep triggering
it" a real (if mild) DoS surface in its own right, not just a brute-force
concern. Same category of known single-instance limitation as D13's
fraud-check scaling caveat: fine at today's solo-`kind` scale, would need
a shared (Redis-backed) store the moment this runs multi-replica.

## System design approach

A new `api` `admin-auth/` module, `@nestjs/passport` + `@nestjs/jwt` +
`bcryptjs` (pure JS, not native `bcrypt` — the existing `node:22-slim`
Dockerfile stages don't need build tooling added just for a password
hash):

```
admin-auth/
  admin-auth.service.ts       # validateAdmin(), issueToken()
  admin-auth.controller.ts    # POST /auth/admin/{login,logout}
  login-throttle.service.ts   # in-memory per-IP attempt counter
  login-throttle.guard.ts     # runs before the credential check
  strategies/
    admin-local.strategy.ts   # username/password -> AdminAuthService
    admin-jwt.strategy.ts     # admin_session cookie -> session payload
  guards/
    admin-local-auth.guard.ts
    admin-jwt-auth.guard.ts   # applied to ModerationController
```

`POST /auth/admin/logout` is deliberately *not* behind the JWT guard —
its only effect is clearing a cookie, and gating it would make it fail
exactly when it's most useful: an already-expired session trying to
clear itself.

## Step-by-step: what actually got built and verified

1. **The module**, wired into `AppModule` and into `ModerationModule`
   (which imports `AdminAuthModule` and exports `AdminJwtAuthGuard` so
   `ModerationController` can reference it directly in `@UseGuards()`).
2. **`main.ts`** gained `cookie-parser` middleware (the JWT strategy
   needs `req.cookies` populated) and `credentials: true` on the CORS
   config.
3. **Six existing e2e specs updated** — every one that calls a
   moderation route (`moderation`, `fraud-checks`, `overall-reviews`,
   `recruiter-ratings`, `review-search`, `company-reviews`) now logs in
   first, via a new shared `api/test/support/admin-session.ts` helper
   rather than duplicating login logic six times.
4. **21 new unit tests** (service/guard/strategy, mocked) + **8 new
   e2e tests** (`admin-auth.e2e-spec.ts`) proving: valid/invalid login,
   cookie-gated moderation access, logout actually invalidates the
   session (re-attaching the cleared cookie still 401s — not just "the
   client forgot it"), and the rate limit trips — deliberately exercised
   against its own freshly-booted app instance so its attempt count
   doesn't compete with the file's earlier login calls.
5. **Live curl verification** against a locally-run `api` (kind's
   Postgres/OpenSearch via port-forward, per D24/D26): no cookie → 401,
   wrong credentials → 401, correct login → 200 with an `HttpOnly`
   `Set-Cookie`, authenticated call → 200, logout → 200, the
   post-logout cookie → 401 again, and three wrong-password attempts
   followed by a 429.

## What this enabled — and what it deliberately broke

Every `ModerationController` route now requires a valid session — which
means `web/src/app/moderation/page.tsx`, built unauthenticated in Phase
14, immediately stopped working against any freshly deployed
environment. That's not a regression to fix here; it's exactly the
handoff issue #160 exists for; the moderation admin surface goes from
"anyone who can reach the URL" to "requires the one shared credential,"
and the frontend gating that makes that usable is deliberately a
separate, sequenced piece of work.
