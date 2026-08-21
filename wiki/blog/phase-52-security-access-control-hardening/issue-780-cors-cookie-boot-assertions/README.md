# Phase 52, Issue #780 — No Boot-Time Assertion for COOKIE_SECURE/CORS_ORIGIN

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52.*

## The gap

Two env vars gate real security properties, and neither one was
required at boot:

- `COOKIE_SECURE` controls whether every session cookie (`admin-auth`,
  `candidate-auth`) sets the `Secure` attribute. `getSessionCookieOptions()`
  used to fall back to a default when it was unset — meaning a
  misconfigured deploy would silently serve session cookies over plain
  HTTP with no `Secure` flag, not fail loudly.
- `CORS_ORIGIN` controls `enableCors()`'s allowed origin. Unset meant no
  CORS policy at all, or a permissive fallback — either way, a
  misconfigured deploy degrades security silently instead of refusing to
  start.

Both are exactly the kind of value that's easy to forget when standing
up a new environment (a new k8s overlay, a new local `.env`) — and both
fail *safe* in the sense that nothing crashes, which is precisely what
makes a silent fallback dangerous: the app looks like it's working.

## The fix: hard-fail at boot, no fallback value

```ts
// session-cookie-options.util.ts
export function getSessionCookieOptions(): SessionCookieOptions {
  if (process.env.COOKIE_SECURE !== 'true' && process.env.COOKIE_SECURE !== 'false') {
    throw new Error('COOKIE_SECURE must be explicitly set to "true" or "false".');
  }
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}
```

```ts
// main.ts
if (!process.env.CORS_ORIGIN) {
  throw new Error('CORS_ORIGIN must be set.');
}
app.enableCors({ origin: process.env.CORS_ORIGIN, credentials: true });
```

Neither check accepts a default. `COOKIE_SECURE` specifically requires
the *string* `"true"` or `"false"` — not merely "truthy" — so an empty
string or a typo'd value fails the same way an entirely absent one
does, rather than silently coercing to a boolean. Every real environment
this project runs in already sets both explicitly (local `.env`, every
k8s overlay's `api-config`), so this only ever catches a genuinely
missing or misconfigured deploy — never a legitimate one.

## Verification

Unit tests for `getSessionCookieOptions()` cover every invalid input —
unset, empty string, and a value other than the two literals — each
asserting a thrown `Error`, plus the two valid cases resolving to the
correct `secure` boolean. On the CI/e2e side, this immediately surfaced
a real gap: `ci.yml`'s `api` job had never set `COOKIE_SECURE` at all,
so the whole e2e suite started failing at boot the moment this landed —
caught and fixed by adding `COOKIE_SECURE: "false"` to the workflow's
env block (CI runs over plain HTTP, same as every local dev
environment), with a comment pointing back at this issue so the
connection isn't lost the next time someone reads that env block cold.
