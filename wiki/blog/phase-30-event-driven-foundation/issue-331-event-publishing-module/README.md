# Phase 30, Issue #331 — Shared Event-Publishing Module + Versioned Event Schema

*Part of Phase 30 — Event-Driven Foundation. See `docs/ROADMAP.md` Phase
30, `docs/DECISIONS.md` D16/D17/D53, and `docs/EVENTS.md`.*

## The gap this closed

Issue #330 stood up a reachable Redpanda broker with nothing publishing
to it. Issue #331 builds the reusable plumbing every future write path
calls — a `DomainEventPublisher` and a versioned event-schema
convention — but deliberately doesn't wire it into any real write path
yet; that's issue #332. Keeping "build the publisher" and "call the
publisher from real code" as separate issues meant the publisher's own
failure modes (broker down, broker absent entirely, a mid-flight
disconnect) could be unit-tested in isolation before any production code
path depended on it.

## Key concept: best-effort, after-commit publishing — extending D16/D17's shape to a broker

D16 and D17 already established a pattern for this project's other
derived, secondary datastore (OpenSearch): a write to the primary store
(Postgres) is the source of truth, and indexing into the secondary store
happens afterward, wrapped in its own try/catch that logs and swallows
failures rather than rethrowing. D53 extends that exact shape to a
message broker instead of a search index — nothing about a Redpanda
outage, or Redpanda not existing at all (true of every environment until
now, and still true of CI's non-e2e jobs), should be able to fail or
block a rating/review write. `EventsModule`'s own comment states the
consequence plainly: a publish failure is "caught, logged, and
swallowed... never throws back to the caller and never fails or rolls
back the write that triggered it."

## Key concept: connect once in `onModuleInit()`, never per-publish

```ts
async onModuleInit(): Promise<void> {
  this.producer.on(this.producer.events.DISCONNECT, () => {
    this.connected = false;
  });
  await this.connect();
}
```

`kafkajs`'s producer holds a persistent connection rather than dialing
fresh per message — the same connection-pooling instinct as a database
client, and for the same reason: TCP/TLS handshake cost per message
would be prohibitive at any real throughput. `DomainEventPublisher`
tracks its own `connected` boolean rather than trusting the underlying
client's internal state directly, because `publish()` needs a cheap,
synchronous-feeling way to decide "should I even attempt a send" without
awaiting a network round-trip on every call:

```ts
async publish<T>(topic: string, event: T, key?: string): Promise<void> {
  if (!this.connected) {
    this.logger.warn(`Dropping event for topic "${topic}" — producer not connected`);
    return;
  }
  try {
    await this.producer.send({ topic, messages: [{ key, value: JSON.stringify(event) }] });
  } catch (err) {
    this.logger.error(`Failed to publish event to topic "${topic}"`, err instanceof Error ? err.stack : err);
  }
}
```

Notably this issue's version of the publisher only *connects* once — it
doesn't yet do anything if that connection is later lost. (A dropped or
never-established connection just meant events silently stopped
publishing until the whole app restarted — a real gap, found in design
review right after this issue merged and fixed immediately after as
issue #459, covered in its own post below.)

## Key concept: versioned event contracts — the version lives in both the type name and the topic name

```ts
// api/src/events/schemas/round-rating-created.event.ts
export const ROUND_RATING_CREATED_V1_TOPIC = 'moderation.round_rating.created.v1';

export interface RoundRatingCreatedEventV1 {
  eventType: 'moderation.round_rating.created';
  eventVersion: 1;
  occurredAt: string; // ISO-8601
  roundRatingId: string;
  roundId: string;
  candidateId: string;
  companyId: string;
  status: 'pending';
}
```

The convention `docs/EVENTS.md` codifies: a breaking change to an
event's shape ships as an entirely new type and a new topic
(`...v2`/`SomeEventV2`), never a mutation of `v1` in place. This matters
specifically because a message broker, unlike a request/response API,
has no built-in way to force every consumer to upgrade in lockstep — a
notification-service consumer (Phase 31) and a review-analyzer consumer
(Phase 32) could each be deployed independently, at different times,
still reading `v1` while a producer starts also emitting `v2`. Keeping
old topics alive unchanged means neither consumer breaks the moment the
other one's contract evolves. Non-breaking changes (a new optional
field) are still allowed in place, since no reasonable consumer schema
would already be validating against the field's *absence*.

Six event types are defined this way for the three moderated entity
types (`round_rating`, `recruiter_rating`, `overall_review`) × two
lifecycle moments (`created`, `status_changed`) — `company` is
explicitly out of scope (a create-company request isn't one of the
"moderated entity types" this pair of issues targets).

## Step-by-step: what actually got built and verified

1. `api/src/events/redpanda-client.provider.ts` — a `Kafka` client
   factory reading `REDPANDA_BROKERS` (issue #330's env var, unused until
   now), mirroring the existing shape of
   `search/opensearch-client.provider.ts`.
2. `api/src/events/domain-event-publisher.ts` — `DomainEventPublisher`,
   connecting once in `onModuleInit()`, disconnecting in
   `onModuleDestroy()`, and a `publish()` method that never throws.
3. Six schema files under `api/src/events/schemas/`, one `v1` interface +
   topic constant each, following the naming convention above.
4. `docs/EVENTS.md` — the contract doc: publishing semantics, versioning
   convention, the full table of defined events, and how to add a new
   one.
5. `.github/workflows/ci.yml`'s `api` job gained a real `redpanda`
   service container (GitHub Actions can't override a container's
   default `CMD`, so CI runs Redpanda's plain default start rather than
   compose's `dev-container`-mode flags — verified locally to behave
   identically for this single-broker, default-listener setup) and a
   `REDPANDA_BROKERS: localhost:9092` env var, so CI exercises a real
   connect, not a mock.
6. Unit tests covering: successful publish, a failed `connect()` never
   throwing and every subsequent `publish()` being a silent no-op, a
   failed `send()` after a successful connect never throwing, and a
   failed `disconnect()` on module teardown never throwing.

## What this enabled

A real publisher exists, unit-tested against every failure mode, with
nothing calling it yet. Issue #332 is the next post in this phase: wiring
`publish()` into the actual create and moderation-decision write paths
for all three entity types.
