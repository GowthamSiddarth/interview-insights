# Phase 20, Issue #222 — Session Cookies Need a Shared `Domain`, Or `web` Never Sees a Real Login

*Part of Phase 20d — Product/UX Polish from Live Verification (originally
filed under Phase 20 — Operational Hardening & Live-Verification
Findings, epic #214, split out 2026-08-09 — see `docs/ROADMAP.md`'s
Phase 20 retired stub). Phase 20 was declared fully done, then reopened
the same day this surfaced. See `docs/ROADMAP.md` Phase 20d and
`docs/DECISIONS.md` D39.*

## Why this is a genuinely interesting bug, not a NavBar typo

The report was simple: "nav bar shows log in even after login." Every
piece of code involved — `NavBar.tsx`'s mount-only session check,
`auth/verify/page.tsx`'s hard `window.location.href` redirect (D32),
`api.ts`'s `hasCandidateSessionHint()` reading `document.cookie` — was
inspected first and found structurally correct, matching exactly what
D32 already built to solve this class of problem. The bug wasn't in
any of that code. It was one property those files all assumed was set
correctly, upstream, and never was.

## Key concept: host-only is the default, and it's the wrong default here

`getSessionCookieOptions()` (`api/src/common/session-cookie-options.util.ts`)
set `httpOnly`, `secure`, `sameSite` — never `domain`. A cookie with no
explicit `Domain` attribute is **host-only**: visible solely to the
exact hostname whose HTTP response set it, not even to that hostname's
own subdomains.

Every deployed environment serves `web` and `api` from genuinely
different hostnames — `app.interview-insights.local` vs
`api.interview-insights.local` in dev, the same `app.*`/`api.*` split
under `.staging.*`/`.prod.*` in the other overlays (`infra/k8s/base/
07-ingress.yaml`, each overlay's Ingress-host patch). `POST
/auth/verify`'s response comes from `api`'s origin. So both
`candidate_session` (httpOnly, the real JWT) and D32's
`candidate_logged_in` hint cookie were scoped to `api`'s hostname only
— structurally invisible to a `document.cookie` read from JS running on
`web`'s hostname, which is exactly where `NavBar` lives.

## Key concept: why nothing caught this until now

Nearly every "verified live in a real browser" pass across this
project's history — Phase 16, Phase 17, Phase 18's own two admin-auth
issues — ran against local `npm run dev` servers on
`localhost:3000`/`localhost:3001`. Browsers scope cookies by **host**,
not port: `localhost` is the same host regardless of which port serves
it, so a cookie set by a response from port 3001 is fully visible to JS
running on port 3000. The bug is invisible in that setup by
construction. It only reproduces against the real Ingress-fronted app,
which needs genuinely different hostnames to route `web` vs `api`
traffic at all — and that's exactly the environment the user was
actually using.

## Key concept: the blast radius was bigger than the NavBar

The wizard's `candidateSession &&` gates — issue #217's create-company
form, the process-creation step — read the exact same hint cookie.
Every one of them silently misfired the same way: a genuinely logged-in
candidate, on any real deployed environment, saw "Log in to submit"
prompts throughout the app. The actual authenticated API calls
themselves were never broken — a browser attaches `candidate_session`
correctly on any request to `api`'s origin regardless of which
hostname the *calling* JS runs on, since that's determined by the
request's target, not the caller's location. Only the *client-side JS
read* of the cookie's presence was broken. Functionally this was closer
to "half the app looks logged out" than a cosmetic label.

## System design approach

```ts
export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  domain?: string;
}

export function getSessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}
```

A new `COOKIE_DOMAIN` env var, same explicit-over-inferred pattern
`COOKIE_SECURE` already established (D27) — default unset, which
reproduces today's host-only behavior exactly, correct for local dev
where `web`/`api` share the `localhost` hostname. Fixed once, in the
shared util already used by both `admin-auth` and `candidate-auth`
(D30's own extraction) — every session cookie in the system gets the
fix, not just the one the report happened to name.

`infra/k8s/base/05-api.yaml`'s `api-config` ConfigMap sets
`COOKIE_DOMAIN: .interview-insights.local` — the shared parent of
`app.*`/`api.*` — inherited by `dev`/`dev-localstack` automatically.
`staging`/`prod` overlays patch it to their own per-environment parent
domain, mirroring the existing `CORS_ORIGIN` patch pattern in the same
two files exactly:

```yaml
- op: replace
  path: /data/COOKIE_DOMAIN
  value: .staging.interview-insights.local
```

## Step-by-step: what actually got diagnosed, fixed, and verified

1. Re-inspected `NavBar.tsx`, `auth/verify/page.tsx`, and `api.ts`'s
   `hasCandidateSessionHint()` — all structurally correct, ruling out a
   regression in D32's own code.
2. Read `getSessionCookieOptions()` directly and noticed no `domain`
   field existed at all — checked the real Ingress manifest and
   overlay patches to confirm `web`/`api` genuinely don't share a
   hostname in any deployed environment.
3. Added `domain` to `SessionCookieOptions`, sourced from a new
   `COOKIE_DOMAIN` env var; 3 new unit tests (unset, empty string,
   explicit value) alongside the existing suite — caught and fixed a
   real test-pollution bug in the process (assigning `process.env.X =
   undefined` in a Jest `afterEach` stringifies to the literal
   `"undefined"` rather than deleting the key, poisoning a later test
   in the same file with a truthy leftover value — fixed by deleting
   the key explicitly when the original was unset).
4. `infra/k8s/base/05-api.yaml` + both `staging`/`prod` overlay patches
   updated; `kubectl kustomize` re-run against all four overlays to
   confirm each renders the expected per-environment value.
5. Full unit suite (260 tests), lint, and build all clean. Full e2e
   suite (105 tests) and the golden-path smoke test (13 steps) re-run
   clean against the real test database.
6. Rebuilt the real `api` image, `kind load`-ed it, applied the updated
   `dev` overlay, rolled `api` out — then `curl`-ed a real magic-link
   verify through the actual Ingress and confirmed `Set-Cookie` now
   carries `Domain=.interview-insights.local` on both
   `candidate_session` and `candidate_logged_in`.
7. Live headless-browser (Playwright) verification through
   `app.interview-insights.local` itself, not a dev server: requested a
   real magic link, fetched it via Mailpit's REST API, verified —
   confirmed NavBar shows "Log out" both immediately after login and
   after a hard page reload, zero console errors.

## What this enabled

A real login now looks like a real login on every deployed environment
this project has — not just on a developer's own machine where the bug
happened to be invisible. It's also a concrete reminder that this
project's "verify live in a real browser" discipline needs to mean the
*actual* target environment specifically when a fix's whole premise is
about cross-hostname behavior — a dev-server pass alone would have
reported success while leaving the real bug in place, exactly as it did
for every prior phase that touched this code.
