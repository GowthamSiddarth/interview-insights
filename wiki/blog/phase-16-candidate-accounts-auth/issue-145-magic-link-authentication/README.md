# Phase 16, Issue #145 — Magic-Link Authentication

*Part of Phase 16 — Candidate Accounts & Auth. Depends on issue #144.
See `docs/ROADMAP.md` Phase 16.*

## Why passwordless, and why now

The email-hash model (`docs/DATA_MODEL.md` design principle 1) already
meant this platform never stores a candidate's raw email — only an HMAC
hash. A password would need its own storage, its own reset flow, and its
own breach surface, for an identity that's already deliberately
minimal. A magic link sidesteps all of that: a clicked link *is* proof
of email ownership, which is the only thing this platform ever actually
needed to establish. It also directly subsumes D14's old gap — the
Phase 3 candidate-verification flow issued a token but never emailed
it — by folding "prove you own this email" and "log in" into the exact
same action instead of two separate systems that could drift apart.

## Key concept: replace, don't leave the insecure version running

The old `candidate-verification/` module is deleted entirely in this
issue, not deprecated-in-place alongside the new flow. D30 spells out
why coexistence would have been worse than removal: leaving a second,
functionally-insecure path to the same outcome (a verified candidate) as
the new one defeats the point of building the new one at all — anyone
could just keep using the old, weaker endpoints. The
`CandidateVerificationToken` table and its hashing utilities are reused,
not duplicated, since the underlying "single-use, hashed, expiring
token" shape didn't need to change — only what triggers issuing one and
what happens when it's consumed.

## Key concept: rate-limit from the start, not as an afterthought

The Phase 16 kickoff brainstorm flagged this before any code was
written: `POST /auth/request-link` is a new *public* endpoint that
accepts an email address and triggers a real side effect (sending
mail). That's the same category of abuse surface admin login already
had to defend against in Phase 18 — so `MagicLinkThrottleService` exists
from this issue's first commit, not bolted on later. Two pieces of
admin-auth's own logic were extracted to `api/src/common/` specifically
so this second consumer couldn't silently drift from a fix the first
one already needed: `session-cookie-options.util.ts` (the
`COOKIE_SECURE` cookie-options object, carrying forward the
Secure-cookie-over-HTTP fix Phase 18 had to learn the hard way) and
`ip-throttle.ts` (the per-IP attempt-counting core both throttle
services now wrap).

## Key concept: never disclose whether an email is known

`requestLink()` never throws on an unknown email — it always returns
the same `{ status: 'ok' }` shape whether or not that email has ever
been seen before. An endpoint that behaves differently for known vs.
unknown emails is a silent account-enumeration oracle; this one
deliberately isn't.

## System design approach

```
api/src/candidate-auth/
  candidate-auth.service.ts        # requestLink(), verify(), issueToken()
  candidate-auth.controller.ts     # POST /auth/{request-link,verify,logout}
  magic-link-throttle.service.ts   # wraps common/ip-throttle.ts
  magic-link-throttle.guard.ts
  strategies/candidate-jwt.strategy.ts   # candidate_session cookie -> payload
  guards/candidate-jwt-auth.guard.ts     # exported, ready for issue #146

api/src/common/
  session-cookie-options.util.ts   # shared with admin-auth
  ip-throttle.ts                   # shared with admin-auth
```

The session shape mirrors `admin_session` exactly (httpOnly JWT cookie,
same `getSessionCookieOptions()`), a deliberate choice from the kickoff
brainstorm over inventing a DB-backed sessions table — stateless and
consistent with the one session mechanism this codebase already trusts.
`CandidateJwtStrategy`/`CandidateJwtAuthGuard` are built and exported
here even though nothing consumes them yet — issue #146 is where they
get applied to write-path controllers.

## Step-by-step: what actually got built and verified

1. **The module**, with `verify()` flipping `verificationStatus` to
   `email_verified` only on a candidate's *first* successful login — a
   repeat login shouldn't overwrite `verifiedAt`. Caught and fixed
   during implementation, before any test ran, by checking the existing
   status inside the transaction first.
2. **21 new unit tests** (service, throttle, strategy, the two shared
   `common/` utils) plus a new 9-test e2e suite
   (`candidate-auth.e2e-spec.ts`) proving the full loop against real
   Postgres *and* real Mailpit: request a link → extract it from
   Mailpit's REST API (not returned by the API — unlike the superseded
   flow) → verify → session cookie → first-login-only `verifiedAt`.
3. **A test-isolation bug found and fixed in this same suite**: an
   early version shared one app instance across the whole file
   (`beforeAll`), and several tests each needing more than one
   `/auth/request-link` call (supersession, re-fetching a link)
   cumulatively tripped the 5-per-window throttle before reaching later
   tests. Fixed by switching to a fresh app per test
   (`beforeEach`/`afterEach`) — the first instance of a pattern that
   recurs repeatedly for the rest of this phase.
4. **A real Docker Compose regression found and fixed while wiring this
   up**: the `full` profile's `api` service had been unable to boot at
   all since Phase 18 shipped, because
   `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH`/`ADMIN_JWT_SECRET`/
   `COOKIE_SECURE` were never added to its environment block, and
   `AdminAuthModule` throws synchronously at boot if any are unset. No
   one had noticed because nothing had actually tried to boot that
   profile since. Fixed alongside adding the new
   `CANDIDATE_JWT_SECRET` to the same block.

## What this enabled

A real, working, rate-limited, non-enumerating passwordless login loop,
independently verified end to end against real Postgres and real
Mailpit. Issue #146 is what actually puts it to use — nothing on the
write path required a session yet, so this issue alone didn't change
what any existing client could do.
