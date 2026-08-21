# Phase 52, Issue #777 — IP-Based Throttles Collapse to One Shared Bucket

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52.*

## The gap

This app has several IP-keyed rate limits — admin login throttling,
candidate magic-link/password-login throttling, all built on the same
shared `IpThrottle` core (`api/src/common/ip-throttle.ts`). Every one of
them keys off Express's `req.ip`. Behind `ingress-nginx` (every real
deployment this project has — kind locally, the Hetzner pilot in
production), every request Express actually sees arrives *from*
ingress-nginx, not from the original client — `req.ip` is ingress-nginx's
own pod address for literally every caller, regardless of who's really
making the request.

The practical effect: every throttle guard in the app was really
enforcing "N attempts total, from anyone, combined" instead of "N
attempts per real client." One aggressive caller could exhaust the
shared bucket and lock out every other real user, and the throttle
itself gave no actual per-attacker protection at all.

## The fix: one line, with a safety condition that has to hold

```ts
// main.ts
// ingress-nginx always overwrites any client-supplied X-Forwarded-For
// rather than appending to it, so trusting exactly one hop is safe here.
app.set('trust proxy', 1);
```

Express's `trust proxy` setting controls how many hops of
`X-Forwarded-For` it trusts when computing `req.ip` — `1` means "trust
the immediate next hop, use the IP it reports." The one-line fix is
trivial; the reasoning that makes it *safe* is the load-bearing part of
this issue. If ingress-nginx *appended* to an incoming
`X-Forwarded-For` header instead of overwriting it, a malicious client
could forge the header with a fake IP, and `trust proxy` would believe
it — the throttle would then key off attacker-controlled input instead
of a real client identifier, actively worse than the collapsed-bucket
bug it replaces. ingress-nginx's documented behavior is to overwrite,
not append, which is what makes trusting exactly one hop correct here —
trusting an arbitrary number of hops, or trusting behind a proxy chain
that appends, would not be.

## Verification

No new automated test — this is fundamentally an infrastructure-topology
claim (what ingress-nginx does with the header) rather than
application logic a unit test can exercise in isolation. Verified by
reading ingress-nginx's own documented `X-Forwarded-For` handling and
cross-checking against the existing throttle guards' real-Postgres e2e
coverage, which already asserts N+1 attempts trip the limit — that
coverage continues to pass unchanged, confirming the throttle logic
itself wasn't touched, only what IP it now correctly sees per caller.
