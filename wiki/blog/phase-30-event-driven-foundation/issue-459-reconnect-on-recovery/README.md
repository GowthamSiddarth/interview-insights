# Phase 30, Issue #459 — `DomainEventPublisher` Reconnect-on-Recovery

*Part of Phase 30 — Event-Driven Foundation. Ad-hoc fix filed under this
phase's own epic, per the ad-hoc-work convention, since it's specific to
this phase's own plumbing rather than a cross-cutting concern. See
`docs/ROADMAP.md` Phase 30 and `docs/EVENTS.md`.*

## The gap this closed

Filed from a design review of issues #330-#332, not from a live incident.
`DomainEventPublisher.onModuleInit()` connected exactly once, at app
boot:

```ts
async onModuleInit(): Promise<void> {
  await this.connect();
}
```

Two scenarios left `connected` stuck at `false` forever, with no retry
of any kind: the broker not yet up when the app boots (a real ordering
race in local dev, where `api` often starts faster than Redpanda's own
readiness), or a connection that succeeded at boot but later dropped —
a Redpanda restart during a `kind` node upgrade, a network blip. Either
way, every subsequent `publish()` call would hit `if (!this.connected)
return` and silently drop the event, forever, until someone noticed and
restarted the whole app. Since publishing is already deliberately
best-effort and swallows its own errors (D16/D17's shape, extended by
D53), there was no loud failure anywhere to force that restart — this
would have degraded silently in production for as long as it took a
human to notice notification-service or review-analyzer (Phase 31/32,
once they exist) had gone quiet.

## Key concept: detecting a live disconnect needs a listener, not just a try/catch

A `try/catch` around `producer.send()` only catches a failure *during*
that specific send — it says nothing about whether the connection is
still healthy for the *next* call. `kafkajs`'s producer emits a
`DISCONNECT` event independently, any time the underlying connection
actually drops, whether or not a send was in flight when it happened:

```ts
async onModuleInit(): Promise<void> {
  this.producer.on(this.producer.events.DISCONNECT, () => {
    this.connected = false;
  });
  await this.connect();
}
```

This is the same category of concept as a database connection pool's
own health-check/keepalive mechanism: a request-scoped try/catch tells
you a specific operation failed, but only an out-of-band listener tells
you the *connection itself* is now unusable for anything that hasn't
been attempted yet.

## Key concept: a continuously-running self-heal, not a one-shot retry scheduled after failure

The fix isn't "if connect fails, schedule one retry" — it's a method
that runs on a fixed interval forever, and is a no-op whenever there's
nothing to do:

```ts
const RECONNECT_INTERVAL_MS = 30_000;

@Interval(RECONNECT_INTERVAL_MS)
async retryConnectIfNeeded(): Promise<void> {
  if (this.connected || this.destroyed) return;
  await this.connect();
}
```

This single method correctly self-heals from *either* gap described
above — a connect that never succeeded at boot, or a live disconnect the
`DISCONNECT` listener just caught — without needing to know which one
happened. A one-shot "retry once after a failed attempt" design would
have needed separate handling for each case (retry-after-boot-failure
vs. retry-after-live-disconnect); a continuous poll collapses both into
one check of the same boolean. The 30-second interval matches the same
class of value `ReconciliationSweepService`'s own staleness window uses
elsewhere in this codebase (Phase 39) — long enough to never hammer a
broker that's genuinely still down, short enough that recovery gets
noticed promptly once the broker is back. `destroyed` guards against the
interval firing after `onModuleDestroy()` has already run (NestJS's
`@nestjs/schedule` intervals aren't automatically torn down just because
the owning provider was destroyed).

## Step-by-step: what actually got built and verified

1. Added a `DISCONNECT` event listener in `onModuleInit()`, setting
   `connected = false` the moment `kafkajs` reports the connection is
   gone.
2. Added `retryConnectIfNeeded()`, decorated with `@Interval` from
   `@nestjs/schedule`, running every 30 seconds and returning immediately
   whenever already connected or already destroyed.
3. Added a `destroyed` flag, set in `onModuleDestroy()`, so a graceful
   shutdown doesn't race with a reconnect attempt firing moments later.
4. Five new unit tests built entirely on a mocked producer's `.on()`
   capturing the registered `DISCONNECT` listener, so the test can
   invoke it directly to simulate a live drop:
   - a connect that failed at boot succeeds on the next
     `retryConnectIfNeeded()` call, and publishing resumes afterward
   - `retryConnectIfNeeded()` is a true no-op while already connected
     (asserted via `producer.connect` not being called again)
   - a live disconnect (via the captured listener) is followed by a
     successful reconnect and resumed publishing
   - no reconnect attempt happens after `onModuleDestroy()`

## What this enabled

`DomainEventPublisher` now recovers from both an unavailable broker at
boot and a broker that drops mid-run, without an app restart — closing
the one operational gap in Phase 30's plumbing before Phase 31
(notification-service) becomes the first real consumer depending on
events actually arriving reliably.
