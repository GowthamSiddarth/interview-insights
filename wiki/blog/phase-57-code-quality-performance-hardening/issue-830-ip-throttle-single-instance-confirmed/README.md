# Phase 57, Issue #830 — IP Throttle State Is In-Memory and Single-Instance Only

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57, `docs/DECISIONS.md` D13.*

## The question

`IpThrottle`'s state lives in a per-process `Map` — resets on restart,
never shared across replicas. Flagged by the audit as worth checking:
is this an acceptable tradeoff for the current deployment, or a real gap
that needs fixing before it causes a problem?

## The finding: already an accepted, already-documented tradeoff

`ip-throttle.ts`'s own comment had already named this limitation
explicitly, tying it to the same class of decision D13 already made for
`fraud-checks.service.ts`'s full-table-scan approach:

```ts
// Same known limitation as fraud-checks.service.ts's full-table-scan
// check (D13): fine for today's single-instance deployment, resets on
// restart, wouldn't coordinate across replicas — revisit if this ever
// runs multi-replica.
```

No code change — this app runs a single replica of each service today
(the Hetzner pilot, and every local/kind environment before it), so
"wouldn't coordinate across replicas" describes a scenario that doesn't
currently exist. Re-confirmed and closed as documentation-only, with a
pointer added directly at the existing comment so the audit trail
connects the original D13-style tradeoff to this issue's explicit
re-check of it:

```ts
// Re-confirmed by the 2026-08-20 pre-launch audit (GitHub issue #830,
// Phase 57): no action needed pre-launch given the current
// single-instance deployment, closed as documentation-only.
```

## Verification

No test — no behavior changed. The verification here was reading the
actual deployment topology (single replica per service, confirmed
against the live k8s manifests) to confirm the existing comment's claim
still holds, rather than assuming it was still accurate without
checking.
