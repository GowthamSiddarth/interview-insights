# Domain events

Event-publishing contract for Phase 30 (Event-Driven Foundation, D53) and
its two downstream consumers, Phase 31 (Notification Service) and Phase 32
(Review Analyzer Service). See `docs/ARCHITECTURE.md` for how the broker
fits into the rest of the system and `docs/DECISIONS.md` D53 for why this
exists at all — this doc is just the contract: what a domain event looks
like, how it's published, and how it's versioned.

## Status

`api/src/events/` (GitHub issue #331) is the reusable plumbing:
`DomainEventPublisher`. As of GitHub issue #332, `ModerationService`
publishes all six event types below from the real write paths — every
incremental create endpoint, the bulk-submission path, and every
approve/reject/flag decision — and `EventsModule` is imported into
`AppModule` (via `ModerationModule`). As of GitHub issue #335,
`notification-service` is the first real consumer — it subscribes to
all three `*.created` topics and sends a "your submission is pending
review" email, idempotently (`services/notification-service/src/
notifications/`, dedupes on entityType+entityId+eventType via its own
`NotificationLog` table). `*.status_changed` consumption (approved/
rejected notifications) is GitHub issue #336, not yet built. Phase 32
(review-analyzer) hasn't started.

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
  If that connection attempt fails (native dev without `redpanda` running,
  a broker restart mid-deploy, etc.), every `publish()` call is a silent
  no-op: logged at `warn`, not `error`, since an unreachable broker isn't
  necessarily a bug. `.github/workflows/ci.yml`'s `api` job runs a real
  `redpanda` service container (GitHub issue #332) — CI exercises the
  real connect-and-publish path, not just the failure path.

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

Six event types — one `*.created` and one `*.status_changed` per
moderated entity type (`round_rating`, `recruiter_rating`,
`overall_review`). `company` (a create-company request, Phase 35) is
deliberately out of scope — see `ModerationService.publishCreatedEvent`/
`publishStatusChangedEvent`'s own comments for why. Every `*.created`
event carries `candidateId`/`companyId` context so a consumer can act
without an immediate callback into the monolith; every `*.status_changed`
event additionally carries `previousStatus` (always `'pending'` —
`ModerationService.review()` only ever runs against an unreviewed entry),
`newStatus`, and the optional `reviewedBy` label.

| Topic | Type | Schema file |
|---|---|---|
| `moderation.round_rating.created.v1` | `RoundRatingCreatedEventV1` | `api/src/events/schemas/round-rating-created.event.ts` |
| `moderation.round_rating.status_changed.v1` | `RoundRatingStatusChangedEventV1` | `api/src/events/schemas/round-rating-status-changed.event.ts` |
| `moderation.recruiter_rating.created.v1` | `RecruiterRatingCreatedEventV1` | `api/src/events/schemas/recruiter-rating-created.event.ts` |
| `moderation.recruiter_rating.status_changed.v1` | `RecruiterRatingStatusChangedEventV1` | `api/src/events/schemas/recruiter-rating-status-changed.event.ts` |
| `moderation.overall_review.created.v1` | `OverallReviewCreatedEventV1` | `api/src/events/schemas/overall-review-created.event.ts` |
| `moderation.overall_review.status_changed.v1` | `OverallReviewStatusChangedEventV1` | `api/src/events/schemas/overall-review-status-changed.event.ts` |

Published from:
- **`*.created`** — `RoundRatingsService.create()`, `RecruiterRatingsService.create()`,
  `OverallReviewsService.create()`, and `BulkProcessSubmissionService.create()`
  (one call per rated/reviewed entity it creates) — all after their
  transaction commits, alongside `indexForSearch()`/AI triage.
- **`*.status_changed`** — `ModerationService.review()`, the shared
  implementation behind `approve()`/`reject()`/`flag()` (and
  `approveWithAudit()`, the AI auto-approval entry point).

`moderation.*.created.v1` is consumed by `notification-service` as of
GitHub issue #335 (the "your submission is pending review" email);
Phase 32's review-analyzer, not yet built, is expected to consume the
same three topics independently (its own consumer group — every
consumer group gets its own copy of every message, so one consumer's
processing never affects another's). `moderation.*.status_changed.v1`
(the approved/rejected notification) has no consumer yet — that's
GitHub issue #336. See #335/#336/#339 for the actual consumer-side
wiring.

## Adding a new event type

1. Add `api/src/events/schemas/<name>.event.ts` — a `v1` type + topic
   constant, following the round-rating example above.
2. Document it in the table above.
3. Call `DomainEventPublisher.publish(topic, event, key)` from the write
   path, after its transaction commits — never inside the transaction,
   and never in a way whose failure could affect the write's own result.
