# Domain events

Event-publishing contract for Phase 30 (Event-Driven Foundation, D53) and
its two downstream consumers, Phase 31 (Notification Service) and Phase 32
(Review Analyzer Service). See `docs/ARCHITECTURE.md` for how the broker
fits into the rest of the system and `docs/DECISIONS.md` D53 for why this
exists at all — this doc is just the contract: what a domain event looks
like, how it's published, and how it's versioned.

## Status

`api/src/events/` (GitHub issue #331) is reusable plumbing only:
`DomainEventPublisher` and one real, documented event type below. Nothing
publishes it from a write path yet, and `EventsModule` isn't imported into
`AppModule` — GitHub issue #332 does both.

## Publishing semantics

Best-effort, after-commit — the same shape `docs/DECISIONS.md` D16/D17
already established for OpenSearch indexing, extended to a message broker
by D53:

- Publishing happens **after** the DB transaction that owns the write has
  already committed, never inside it. The primary write (Postgres) is the
  source of truth; a domain event is a derived side-effect.
- A publish failure — the broker down, a connection error, anything — is
  caught, logged, and swallowed. It never throws back to the caller and
  never fails or rolls back the write that triggered it.
- `DomainEventPublisher` connects its producer once, in `onModuleInit()`.
  If that connection attempt fails (e.g. no broker reachable — true of
  every environment until a consumer is deployed, and always true in CI,
  which doesn't run Redpanda), every `publish()` call is a silent no-op:
  logged at `warn`, not `error`, since an unreachable broker is an
  expected steady state today, not a bug.

## Versioning convention

Each event type is a TypeScript interface named `<Thing>EventV<n>`, paired
with a topic-name constant of the form
`<domain>.<entity>.<action>.v<n>` — the version number appears in **both**
the type name and the topic name. A breaking change to an event's shape
ships as a new type + new topic (`v2`), not a mutation of `v1` — existing
consumers keep reading the `v1` topic unchanged until they're migrated on
their own schedule, instead of every consumer having to update in
lockstep with the producer.

Non-breaking changes (a new optional field) can be added to the existing
version in place.

## Defined events

### `moderation.round_rating.created.v1`

`api/src/events/schemas/round-rating-created.event.ts` —
`RoundRatingCreatedEventV1`:

| Field | Type | Notes |
|---|---|---|
| `eventType` | `'moderation.round_rating.created'` | |
| `eventVersion` | `1` | |
| `occurredAt` | `string` (ISO-8601) | Event creation time, not necessarily the DB row's `createdAt` |
| `roundRatingId` | `string` | |
| `roundId` | `string` | |
| `companyId` | `string` | Denormalized onto the event so a consumer never needs a callback query just to know which company a rating belongs to |
| `status` | `'pending'` | Always `'pending'` at creation — see `docs/DATA_MODEL.md` |

Not yet published anywhere (GitHub issue #332). Once wired, this is the
event both Phase 31's "your submission is pending review" notification
and Phase 32's review-analyzer are expected to consume — see their own
issues (#335, #339) for the actual consumer-side wiring.

## Adding a new event type

1. Add `api/src/events/schemas/<name>.event.ts` — a `v1` type + topic
   constant, following the round-rating example above.
2. Document it in the table above.
3. Call `DomainEventPublisher.publish(topic, event, key)` from the write
   path, after its transaction commits — never inside the transaction,
   and never in a way whose failure could affect the write's own result.
