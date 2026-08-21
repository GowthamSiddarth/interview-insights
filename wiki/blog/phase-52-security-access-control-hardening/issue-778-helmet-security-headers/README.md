# Phase 52, Issue #778 — Add Helmet Security Headers

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52.*

## The gap

None of the three NestJS services (`api`, `notification-service`,
`review-analyzer`) set any of the standard defensive HTTP response
headers — no `X-Content-Type-Options`, no `Content-Security-Policy`, no
`Strict-Transport-Security`, no `Referrer-Policy`. A missing
`X-Content-Type-Options: nosniff` in particular lets a browser
MIME-sniff a response into something more dangerous than its declared
`Content-Type` — low-probability given every response here is JSON, but
free to close and standard practice regardless.

## The fix: `helmet()`, no per-service tuning needed

[`helmet`](https://helmetjs.github.io/) is a single middleware that sets
a whole bundle of these headers with sane defaults. Added identically to
all three services:

```ts
// main.ts (api, notification-service, review-analyzer — identical)
import helmet from 'helmet';
// ...
app.use(helmet());
```

The one header worth a deliberate look — `contentSecurityPolicy` — stays
at helmet's own default rather than getting a custom policy tuned for
this app's `web` frontend origin. That's not an oversight: none of these
three services ever serves HTML. `api`/`notification-service`/
`review-analyzer` are pure JSON APIs and a Kafka consumer respectively —
`web` (the actual Next.js frontend, the only place a browser ever
renders HTML from this stack) is a separate deployable with its own CSP
concerns, out of scope for this issue.

## Verification

`helmet()`'s own header-setting behavior is well-established upstream
(this app doesn't test third-party middleware internals) — verified by
confirming the middleware is actually registered before the app starts
handling requests (unit-testable: each service's `main.ts` calls
`app.use(helmet())` unconditionally, no env-gated skip path to miss) and
by a manual `curl -I` against a running local instance of each service
confirming `X-Content-Type-Options: nosniff` and friends are present on
a real response.
